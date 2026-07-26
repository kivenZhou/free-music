#import <AVFoundation/AVFoundation.h>
#import <Foundation/Foundation.h>
#import <Speech/Speech.h>
#import <math.h>
#import <stdatomic.h>

typedef void (*VoiceTranscriptCb)(const char *text, int is_final, void *userdata);
typedef void (*VoiceStatusCb)(const char *status, const char *detail, void *userdata);

static VoiceTranscriptCb g_transcript_cb = NULL;
static VoiceStatusCb g_status_cb = NULL;
static void *g_userdata = NULL;

static SFSpeechRecognizer *g_recognizer = nil;
static AVAudioEngine *g_engine = nil;
static SFSpeechAudioBufferRecognitionRequest *g_request = nil;
static SFSpeechRecognitionTask *g_task = nil;
static BOOL g_running = NO;
static BOOL g_restarting = NO;
static BOOL g_speaking = NO;
static BOOL g_tap_installed = NO;
static BOOL g_restart_pending = NO;
static NSTimer *g_segment_timer = nil;
static NSTimer *g_watchdog_timer = nil;
static NSTimeInterval g_last_session_ok_at = 0;
/// EMA of input RMS for smooth far-field AGC (laptop mics are near-field).
static float g_agc_rms = 0.02f;
/// Tap callback must stop feeding before we tear down the Speech request.
static atomic_bool g_feed_audio = false;

static AVSpeechSynthesizer *g_synth = nil;

@interface YZSpeechDelegate : NSObject <AVSpeechSynthesizerDelegate>
@property(nonatomic, copy) void (^onDone)(void);
@end

@implementation YZSpeechDelegate
- (void)speechSynthesizer:(AVSpeechSynthesizer *)synthesizer
    didFinishSpeechUtterance:(AVSpeechUtterance *)utterance {
  (void)synthesizer;
  (void)utterance;
  if (self.onDone) self.onDone();
}
- (void)speechSynthesizer:(AVSpeechSynthesizer *)synthesizer
    didCancelSpeechUtterance:(AVSpeechUtterance *)utterance {
  (void)synthesizer;
  (void)utterance;
  if (self.onDone) self.onDone();
}
@end

static YZSpeechDelegate *g_synth_delegate = nil;

static void emit_status(const char *status, NSString *detail) {
  if (!g_status_cb) return;
  const char *d = detail ? detail.UTF8String : "";
  g_status_cb(status, d, g_userdata);
}

static void emit_transcript(NSString *text, BOOL isFinal) {
  if (!g_transcript_cb || text.length == 0 || g_speaking) return;
  g_transcript_cb(text.UTF8String, isFinal ? 1 : 0, g_userdata);
}

static void apply_soft_agc(AVAudioPCMBuffer *buffer) {
  if (!buffer.floatChannelData || buffer.frameLength == 0) return;
  const AVAudioFrameCount frames = buffer.frameLength;
  const UInt32 chCount = buffer.format.channelCount;
  if (chCount == 0) return;

  double sumSq = 0.0;
  AVAudioFrameCount n = 0;
  for (UInt32 ch = 0; ch < chCount; ch++) {
    float *samples = buffer.floatChannelData[ch];
    if (!samples) continue;
    for (AVAudioFrameCount i = 0; i < frames; i++) {
      double v = samples[i];
      sumSq += v * v;
      n++;
    }
  }
  if (n == 0) return;
  float rms = (float)sqrt(sumSq / (double)n);
  if (rms < 0.00015f) return;

  const float attack = 0.55f;
  const float release = 0.05f;
  if (rms > g_agc_rms) {
    g_agc_rms += (rms - g_agc_rms) * attack;
  } else {
    g_agc_rms += (rms - g_agc_rms) * release;
  }

  float level = g_agc_rms;
  if (level < 0.0005f) level = 0.0005f;
  const float target = 0.34f;
  float gain = target / level;
  if (gain < 1.0f) gain = 1.0f;
  if (gain > 28.0f) gain = 28.0f;

  for (UInt32 ch = 0; ch < chCount; ch++) {
    float *samples = buffer.floatChannelData[ch];
    if (!samples) continue;
    for (AVAudioFrameCount i = 0; i < frames; i++) {
      float v = samples[i] * gain;
      if (v > 0.90f) v = 0.90f + (v - 0.90f) * 0.10f;
      if (v < -0.90f) v = -0.90f + (v + 0.90f) * 0.10f;
      if (v > 1.f) v = 1.f;
      if (v < -1.f) v = -1.f;
      samples[i] = v;
    }
  }
}

/// Stop Speech task/request only. Keep AVAudioEngine alive so we don't race
/// WebKit HTMLAudio on CoreAudio's IO thread (was EXC_BAD_ACCESS / SIGSEGV).
static void pause_recognition_only(void) {
  atomic_store(&g_feed_audio, false);

  if (g_segment_timer) {
    [g_segment_timer invalidate];
    g_segment_timer = nil;
  }

  SFSpeechRecognitionTask *task = g_task;
  g_task = nil;
  SFSpeechAudioBufferRecognitionRequest *request = g_request;
  g_request = nil;

  if (task) {
    [task cancel];
  }
  if (request) {
    @try {
      [request endAudio];
    } @catch (__unused NSException *e) {
    }
  }
}

static void uninstall_engine_fully(void) {
  pause_recognition_only();
  if (!g_engine) {
    g_tap_installed = NO;
    return;
  }
  if (g_tap_installed) {
    @try {
      [g_engine.inputNode removeTapOnBus:0];
    } @catch (__unused NSException *e) {
    }
    g_tap_installed = NO;
  }
  if (g_engine.isRunning) {
    [g_engine stop];
  }
  @try {
    [g_engine reset];
  } @catch (__unused NSException *e) {
  }
}

static void release_engine_deferred(void) {
  uninstall_engine_fully();
  AVAudioEngine *engine = g_engine;
  g_engine = nil;
  if (!engine) return;
  // Hold the last retain across a tick so HAL IOThread can unwind.
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.45 * NSEC_PER_SEC)),
                 dispatch_get_main_queue(), ^{
                   (void)engine;
                 });
}

static void start_recognition_session(void);
static void arm_watchdog(void);

/// Minimum gap between recognition restarts — prevents thrashing that makes wake impossible.
static const NSTimeInterval kMinRestartGap = 3.5;
static NSTimeInterval g_last_restart_at = 0;

static void schedule_restart(void) {
  if (!g_running) return;
  if (g_speaking) {
    g_restart_pending = YES;
    return;
  }
  if (g_restarting) {
    g_restart_pending = YES;
    return;
  }

  NSTimeInterval now = [NSDate date].timeIntervalSince1970;
  NSTimeInterval wait = 0.20;
  if (g_last_restart_at > 0) {
    NSTimeInterval since = now - g_last_restart_at;
    if (since < kMinRestartGap) {
      wait = kMinRestartGap - since;
    }
  }

  g_restarting = YES;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(wait * NSEC_PER_SEC)),
                 dispatch_get_main_queue(), ^{
                   g_restarting = NO;
                   if (!g_running) return;
                   if (g_speaking) {
                     g_restart_pending = YES;
                     return;
                   }
                   // Consume pending flags from the wait window — do NOT chain another
                   // restart after a successful start (that was killing fresh sessions).
                   g_restart_pending = NO;
                   g_last_restart_at = [NSDate date].timeIntervalSince1970;
                   start_recognition_session();
                 });
}

static void note_session_alive(void) {
  g_last_session_ok_at = [NSDate date].timeIntervalSince1970;
}

static void arm_watchdog(void) {
  if (g_watchdog_timer) {
    [g_watchdog_timer invalidate];
    g_watchdog_timer = nil;
  }
  if (!g_running) return;
  g_watchdog_timer =
      [NSTimer scheduledTimerWithTimeInterval:8.0
                                      repeats:YES
                                        block:^(__unused NSTimer *timer) {
                                          if (!g_running || g_speaking || g_restarting) return;
                                          // Only recover truly dead sessions — not brief recycle gaps.
                                          BOOL hasSession = g_task && g_request &&
                                                            atomic_load(&g_feed_audio);
                                          BOOL engineOk = g_engine && g_engine.isRunning;
                                          NSTimeInterval now = [NSDate date].timeIntervalSince1970;
                                          BOOL stale = g_last_session_ok_at > 0 &&
                                                       (now - g_last_session_ok_at > 40.0);
                                          if ((!hasSession && !g_restarting) || !engineOk || stale) {
                                            emit_status("listening", @"正在恢复聆听…");
                                            schedule_restart();
                                          }
                                        }];
}

static BOOL text_looks_like_wake(NSString *text) {
  if (text.length == 0) return NO;
  NSString *s = [[text lowercaseString]
      stringByReplacingOccurrencesOfString:@" "
                                 withString:@""];
  NSArray<NSString *> *needles = @[
    @"小栈", @"小站", @"小战", @"小占", @"小赞", @"小张", @"小章", @"校长",
    @"嚣张", @"小镇", @"小江", @"音栈", @"银站", @"小展", @"小斩", @"xiaozhan"
  ];
  for (NSString *n in needles) {
    if ([s containsString:n]) return YES;
  }
  return NO;
}

static BOOL ensure_engine_running(void) {
  if (!g_engine) {
    g_engine = [[AVAudioEngine alloc] init];
    g_tap_installed = NO;
  }

  AVAudioFormat *format = [g_engine.inputNode outputFormatForBus:0];
  if (format.sampleRate <= 0 || format.channelCount <= 0) {
    // Device route can go invalid after long playback — rebuild once.
    uninstall_engine_fully();
    g_engine = [[AVAudioEngine alloc] init];
    g_tap_installed = NO;
    format = [g_engine.inputNode outputFormatForBus:0];
    if (format.sampleRate <= 0 || format.channelCount <= 0) {
      emit_status("error", @"无法读取麦克风音频格式");
      return NO;
    }
  }

  if (!g_tap_installed) {
    [g_engine.inputNode installTapOnBus:0
                             bufferSize:2048
                                 format:format
                                  block:^(AVAudioPCMBuffer *buffer, AVAudioTime *when) {
                                    (void)when;
                                    if (!atomic_load(&g_feed_audio) || g_speaking) return;
                                    SFSpeechAudioBufferRecognitionRequest *req = g_request;
                                    if (!req) return;
                                    apply_soft_agc(buffer);
                                    [req appendAudioPCMBuffer:buffer];
                                  }];
    g_tap_installed = YES;
  }

  if (!g_engine.isRunning) {
    NSError *startErr = nil;
    [g_engine prepare];
    if (![g_engine startAndReturnError:&startErr]) {
      // Last resort: recreate engine + tap.
      uninstall_engine_fully();
      g_engine = [[AVAudioEngine alloc] init];
      g_tap_installed = NO;
      format = [g_engine.inputNode outputFormatForBus:0];
      if (format.sampleRate <= 0 || format.channelCount <= 0) {
        emit_status("error",
                    startErr.localizedDescription ?: @"无法启动麦克风采集");
        return NO;
      }
      [g_engine.inputNode installTapOnBus:0
                               bufferSize:2048
                                   format:format
                                    block:^(AVAudioPCMBuffer *buffer, AVAudioTime *when) {
                                      (void)when;
                                      if (!atomic_load(&g_feed_audio) || g_speaking) return;
                                      SFSpeechAudioBufferRecognitionRequest *req = g_request;
                                      if (!req) return;
                                      apply_soft_agc(buffer);
                                      [req appendAudioPCMBuffer:buffer];
                                    }];
      g_tap_installed = YES;
      startErr = nil;
      [g_engine prepare];
      if (![g_engine startAndReturnError:&startErr]) {
        emit_status("error",
                    startErr.localizedDescription ?: @"无法启动麦克风采集");
        return NO;
      }
    }
  }
  return YES;
}

static void start_recognition_session(void) {
  if (!g_running || !g_recognizer || g_speaking) return;

  // Recycle Speech request/task only — never stop AVAudioEngine here.
  pause_recognition_only();

  if (![g_recognizer isAvailable]) {
    emit_status("error", @"系统语音识别当前不可用，请检查网络或「系统设置 → 键盘 → 听写」。");
    schedule_restart();
    return;
  }

  if (!ensure_engine_running()) {
    // Stay recoverable — watchdog / pending restart will try again.
    g_restart_pending = YES;
    schedule_restart();
    return;
  }

  g_agc_rms = 0.0025f;
  g_request = [[SFSpeechAudioBufferRecognitionRequest alloc] init];
  g_request.shouldReportPartialResults = YES;
  g_request.taskHint = SFSpeechRecognitionTaskHintDictation;
  g_request.contextualStrings = @[
    @"小栈小栈", @"小栈", @"小站小站", @"小站", @"小张小张", @"小张",
    @"校长校长", @"校长", @"嚣张", @"音栈", @"银站",
    @"继续", @"继续播放", @"暂停", @"下一首", @"上一首", @"换一首",
    @"帮我播放", @"我想听", @"播放", @"静音", @"大声点", @"小声点",
    @"切歌", @"停止", @"来一首", @"在呢", @"在吗"
  ];
  if (@available(macOS 13.0, *)) {
    g_request.requiresOnDeviceRecognition = NO;
  }

  atomic_store(&g_feed_audio, true);
  note_session_alive();

  g_task = [g_recognizer
      recognitionTaskWithRequest:g_request
                   resultHandler:^(SFSpeechRecognitionResult *result, NSError *error) {
                     if (g_speaking) return;
                     if (result) {
                       note_session_alive();
                       NSString *best =
                           result.bestTranscription.formattedString ?: @"";
                       if (!text_looks_like_wake(best)) {
                         for (SFTranscription *alt in result.transcriptions) {
                           NSString *t = alt.formattedString ?: @"";
                           if (text_looks_like_wake(t)) {
                             best = t;
                             break;
                           }
                         }
                       }
                       // Keep feeding partials — do NOT restart on isFinal.
                       // Restarting every final was chopping wake phrases mid-utterance.
                       emit_transcript(best, result.isFinal);
                     }
                     if (error) {
                       NSInteger code = error.code;
                       // Cancel / no-speech from our own recycle — ignore.
                       if (code == 203 || code == 216 || code == 301 || code == 1 ||
                           code == 1110) {
                         return;
                       }
                       NSString *desc =
                           (error.localizedDescription ?: @"").lowercaseString;
                       if ([desc containsString:@"cancel"] ||
                           [desc containsString:@"no speech"]) {
                         return;
                       }
                       if (g_running && !g_speaking) {
                         schedule_restart();
                       }
                     }
                   }];

  // Speech cloud sessions eventually expire; recycle gently (~50s).
  g_segment_timer =
      [NSTimer scheduledTimerWithTimeInterval:50.0
                                      repeats:NO
                                        block:^(__unused NSTimer *timer) {
                                          if (!g_running || g_speaking) return;
                                          schedule_restart();
                                        }];

  emit_status("listening", @"正在聆听「小栈」或「小栈小栈」");
  arm_watchdog();
}

static int score_zh_voice(AVSpeechSynthesisVoice *v) {
  if (!v) return -1;
  NSString *lang = v.language ?: @"";
  int score = 0;
  if ([lang hasPrefix:@"zh-CN"] || [lang hasPrefix:@"zh-Hans"]) {
    score += 80;
  } else if ([lang hasPrefix:@"zh"]) {
    score += 20;
  } else {
    return -1;
  }

  NSString *ident = (v.identifier ?: @"").lowercaseString;
  NSString *name = (v.name ?: @"").lowercaseString;

  if ([ident containsString:@"premium"] || [name containsString:@"premium"]) {
    score += 120;
  } else if ([ident containsString:@"enhanced"] || [name containsString:@"enhanced"]) {
    score += 70;
  } else if (@available(macOS 13.0, *)) {
    if (v.quality >= AVSpeechSynthesisVoiceQualityEnhanced) score += 70;
  }

  if ([ident containsString:@"siri_female_zh-cn"] ||
      [name containsString:@"yu-shu"] || [name containsString:@"yushu"] ||
      [name containsString:@"语舒"]) {
    score += 50;
  } else if ([ident containsString:@"ting"] || [name containsString:@"ting"] ||
             [name containsString:@"婷"]) {
    score += 15;
  }

  if (@available(macOS 10.15, *)) {
    if (v.gender == AVSpeechSynthesisVoiceGenderFemale) score += 25;
    if (v.gender == AVSpeechSynthesisVoiceGenderMale) score -= 10;
  }

  if ([ident containsString:@"compact"] &&
      ![ident containsString:@"premium"] &&
      ![ident containsString:@"enhanced"]) {
    score -= 20;
  }
  return score;
}

static AVSpeechSynthesisVoice *pick_zh_voice(void) {
  NSArray<AVSpeechSynthesisVoice *> *all = [AVSpeechSynthesisVoice speechVoices];
  AVSpeechSynthesisVoice *best = nil;
  int bestScore = -1;
  for (AVSpeechSynthesisVoice *v in all) {
    int s = score_zh_voice(v);
    if (s > bestScore) {
      bestScore = s;
      best = v;
    }
  }
  if (best) return best;

  NSArray<NSString *> *prefs = @[
    @"com.apple.ttsbundle.siri_female_zh-CN_premium",
    @"com.apple.voice.compact.zh-CN.YuShu",
    @"com.apple.ttsbundle.siri_female_zh-CN_compact",
    @"com.apple.ttsbundle.Ting-Ting-premium",
    @"com.apple.ttsbundle.Ting-Ting-compact",
  ];
  for (NSString *ident in prefs) {
    AVSpeechSynthesisVoice *v = [AVSpeechSynthesisVoice voiceWithIdentifier:ident];
    if (v) return v;
  }
  return [AVSpeechSynthesisVoice voiceWithLanguage:@"zh-CN"];
}

/// Speak Chinese reply. Mute Speech feeding; keep mic engine running.
int voice_macos_speak(const char *text_utf8) {
  if (!text_utf8) return -1;
  NSString *text = [NSString stringWithUTF8String:text_utf8];
  if (text.length == 0) return 0;

  dispatch_semaphore_t sem = dispatch_semaphore_create(0);
  __block int ok = 0;

  dispatch_async(dispatch_get_main_queue(), ^{
    g_speaking = YES;
    pause_recognition_only();
    emit_status("speaking", text);

    if (!g_synth) {
      g_synth = [[AVSpeechSynthesizer alloc] init];
    }
    if (!g_synth_delegate) {
      g_synth_delegate = [[YZSpeechDelegate alloc] init];
    }
    g_synth.delegate = g_synth_delegate;
    g_synth_delegate.onDone = ^{
      g_speaking = NO;
      ok = 1;
      emit_status("awake", @"请说指令：下一首、暂停、上一首…");
      if (g_running) {
        g_restart_pending = YES;
        schedule_restart();
      }
      dispatch_semaphore_signal(sem);
    };

    if ([g_synth isSpeaking]) {
      [g_synth stopSpeakingAtBoundary:AVSpeechBoundaryImmediate];
    }

    AVSpeechUtterance *utt = [AVSpeechUtterance speechUtteranceWithString:text];
    utt.voice = pick_zh_voice();
    utt.rate = AVSpeechUtteranceDefaultSpeechRate * 0.84f;
    utt.pitchMultiplier = 1.0f;
    utt.volume = 0.72f;
    utt.preUtteranceDelay = 0.02;
    utt.postUtteranceDelay = 0.06;
    [g_synth speakUtterance:utt];
  });

  long wait = dispatch_semaphore_wait(
      sem, dispatch_time(DISPATCH_TIME_NOW, (int64_t)(24 * NSEC_PER_SEC)));
  if (wait != 0) {
    dispatch_async(dispatch_get_main_queue(), ^{
      g_speaking = NO;
      [g_synth stopSpeakingAtBoundary:AVSpeechBoundaryImmediate];
      if (g_running) {
        g_restart_pending = YES;
        schedule_restart();
      }
    });
    return -2;
  }
  return ok ? 0 : -3;
}

static void begin_after_auth(void) {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (!g_running) return;

    NSLocale *locale = [NSLocale localeWithLocaleIdentifier:@"zh-CN"];
    g_recognizer = [[SFSpeechRecognizer alloc] initWithLocale:locale];
    if (!g_recognizer) {
      g_recognizer =
          [[SFSpeechRecognizer alloc] initWithLocale:[NSLocale localeWithLocaleIdentifier:@"zh-Hans"]];
    }
    if (!g_recognizer) {
      g_recognizer = [[SFSpeechRecognizer alloc] init];
    }
    if (!g_recognizer) {
      emit_status("error", @"无法创建语音识别器（需要中文语音支持）");
      g_running = NO;
      return;
    }

    g_engine = [[AVAudioEngine alloc] init];
    g_tap_installed = NO;
    start_recognition_session();
  });
}

int voice_macos_start(VoiceTranscriptCb transcript_cb, VoiceStatusCb status_cb,
                      void *userdata) {
  if (g_running) return 1;

  g_transcript_cb = transcript_cb;
  g_status_cb = status_cb;
  g_userdata = userdata;
  g_running = YES;
  g_restarting = NO;
  g_speaking = NO;
  g_restart_pending = NO;
  g_last_session_ok_at = 0;
  g_last_restart_at = 0;
  atomic_store(&g_feed_audio, false);

  NSString *bundlePath = [[NSBundle mainBundle] bundlePath] ?: @"";
  NSString *usage = [[NSBundle mainBundle]
      objectForInfoDictionaryKey:@"NSSpeechRecognitionUsageDescription"];
  BOOL isAppBundle = [bundlePath hasSuffix:@".app"];
  if (!isAppBundle || usage.length == 0) {
    g_running = NO;
    emit_status(
        "error",
        @"当前是开发版裸进程，系统会禁止语音识别。"
         "请关闭语音助手；正式打包的 YinZhan.app 可用「小栈小栈」。");
    g_transcript_cb = NULL;
    g_status_cb = NULL;
    g_userdata = NULL;
    return -1;
  }

  emit_status("starting", @"正在请求麦克风与语音识别权限");

  [SFSpeechRecognizer
      requestAuthorization:^(SFSpeechRecognizerAuthorizationStatus status) {
        if (status != SFSpeechRecognizerAuthorizationStatusAuthorized) {
          g_running = NO;
          emit_status("error", @"未授予语音识别权限，请在系统设置中允许音栈使用语音识别");
          return;
        }

        [AVCaptureDevice
            requestAccessForMediaType:AVMediaTypeAudio
                    completionHandler:^(BOOL granted) {
                      if (!granted) {
                        g_running = NO;
                        emit_status(
                            "error",
                            @"未授予麦克风权限，请在系统设置 → 隐私与安全性 → 麦克风中允许音栈");
                        return;
                      }
                      begin_after_auth();
                    }];
      }];

  return 0;
}

void voice_macos_stop(void) {
  g_running = NO;
  g_restarting = NO;
  g_speaking = NO;
  g_restart_pending = NO;
  atomic_store(&g_feed_audio, false);
  dispatch_async(dispatch_get_main_queue(), ^{
    if (g_watchdog_timer) {
      [g_watchdog_timer invalidate];
      g_watchdog_timer = nil;
    }
    if (g_synth && [g_synth isSpeaking]) {
      [g_synth stopSpeakingAtBoundary:AVSpeechBoundaryImmediate];
    }
    release_engine_deferred();
    g_recognizer = nil;
    emit_status("stopped", @"语音助手已关闭");
    g_transcript_cb = NULL;
    g_status_cb = NULL;
    g_userdata = NULL;
  });
}

int voice_macos_is_running(void) { return g_running ? 1 : 0; }

/// Pause Speech feeding while external TTS (e.g. Edge / afplay) runs.
/// Do not stop AVAudioEngine — that raced WebKit playback and crashed.
int voice_macos_begin_external_speak(const char *detail_utf8) {
  NSString *detail = detail_utf8
                         ? [NSString stringWithUTF8String:detail_utf8]
                         : @"…";
  void (^block)(void) = ^{
    g_speaking = YES;
    pause_recognition_only();
    if (g_synth && [g_synth isSpeaking]) {
      [g_synth stopSpeakingAtBoundary:AVSpeechBoundaryImmediate];
    }
    emit_status("speaking", detail.length ? detail : @"…");
  };
  if ([NSThread isMainThread]) {
    block();
  } else {
    dispatch_sync(dispatch_get_main_queue(), block);
  }
  return 0;
}

int voice_macos_end_external_speak(void) {
  void (^endBlock)(void) = ^{
    g_speaking = NO;
    emit_status("awake", @"请说指令：下一首、暂停、上一首…");
    if (g_running) {
      g_restart_pending = YES;
      schedule_restart();
    }
  };
  if ([NSThread isMainThread]) {
    endBlock();
  } else {
    dispatch_sync(dispatch_get_main_queue(), endBlock);
  }
  return 0;
}
