use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

#[cfg(target_os = "macos")]
mod macos {
    use super::*;
    use std::ffi::{c_char, c_int, c_void, CStr};
    use std::path::Path;
    use std::sync::OnceLock;

    type TranscriptCb = unsafe extern "C" fn(*const c_char, c_int, *mut c_void);
    type StatusCb = unsafe extern "C" fn(*const c_char, *const c_char, *mut c_void);

    unsafe extern "C" {
        fn voice_macos_start(
            transcript_cb: TranscriptCb,
            status_cb: StatusCb,
            userdata: *mut c_void,
        ) -> c_int;
        fn voice_macos_stop();
        fn voice_macos_is_running() -> c_int;
        fn voice_macos_speak(text: *const c_char) -> c_int;
        fn voice_macos_begin_external_speak(detail: *const c_char) -> c_int;
        fn voice_macos_end_external_speak() -> c_int;
    }

    static APP: OnceLock<AppHandle> = OnceLock::new();

    unsafe extern "C" fn on_transcript(text: *const c_char, is_final: c_int, _ud: *mut c_void) {
        if text.is_null() {
            return;
        }
        let Ok(s) = (unsafe { CStr::from_ptr(text) }).to_str() else {
            return;
        };
        if s.trim().is_empty() {
            return;
        }
        if let Some(app) = APP.get() {
            let _ = app.emit(
                "voice-transcript",
                VoiceTranscript {
                    text: s.to_string(),
                    is_final: is_final != 0,
                },
            );
        }
    }

    unsafe extern "C" fn on_status(status: *const c_char, detail: *const c_char, _ud: *mut c_void) {
        let status = if status.is_null() {
            "unknown"
        } else {
            unsafe { CStr::from_ptr(status) }
                .to_str()
                .unwrap_or("unknown")
        };
        let detail = if detail.is_null() {
            String::new()
        } else {
            unsafe { CStr::from_ptr(detail) }
                .to_string_lossy()
                .into_owned()
        };
        if let Some(app) = APP.get() {
            let _ = app.emit(
                "voice-status",
                VoiceStatusPayload {
                    status: status.to_string(),
                    detail,
                },
            );
        }
    }

    pub fn start(app: AppHandle) -> Result<(), String> {
        let _ = APP.set(app.clone());
        let rc = unsafe { voice_macos_start(on_transcript, on_status, std::ptr::null_mut()) };
        if rc > 0 {
            return Err("语音助手已在运行".into());
        }
        if rc < 0 {
            return Err(
                "当前是开发版，系统禁止裸进程使用语音识别。请用打包后的 YinZhan.app，或先关闭语音助手。"
                    .into(),
            );
        }
        Ok(())
    }

    pub fn stop() {
        unsafe { voice_macos_stop() };
    }

    pub fn is_running() -> bool {
        unsafe { voice_macos_is_running() != 0 }
    }

    pub fn speak(text: &str) -> Result<(), String> {
        let c = std::ffi::CString::new(text).map_err(|_| "播报文本无效".to_string())?;
        let rc = unsafe { voice_macos_speak(c.as_ptr()) };
        if rc != 0 {
            return Err(format!("语音播报失败 ({rc})"));
        }
        Ok(())
    }

    pub fn begin_external_speak(detail: &str) {
        let c = std::ffi::CString::new(detail).unwrap_or_default();
        unsafe {
            voice_macos_begin_external_speak(c.as_ptr());
        }
    }

    pub fn end_external_speak() {
        unsafe {
            voice_macos_end_external_speak();
        }
    }

    /// Play mp3 via afplay so we don't steal WKWebView's audio device (AVAudioPlayer did).
    pub fn play_mp3_file(path: &Path) -> Result<(), String> {
        let s = path
            .to_str()
            .ok_or_else(|| "音频路径无效".to_string())?;
        begin_external_speak("…");
        let status = std::process::Command::new("afplay")
            .arg(s)
            .status()
            .map_err(|e| {
                end_external_speak();
                format!("afplay 失败: {e}")
            })?;
        end_external_speak();
        if !status.success() {
            return Err(format!("afplay 退出码异常: {status}"));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceTranscript {
    pub text: String,
    pub is_final: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct VoiceStatusPayload {
    pub status: String,
    pub detail: String,
}

pub struct VoiceState {
    pub desired: AtomicBool,
    /// Serialize start/stop so rapid toggles don't race native Speech APIs.
    pub gate: Mutex<()>,
}

impl Default for VoiceState {
    fn default() -> Self {
        Self {
            desired: AtomicBool::new(false),
            gate: Mutex::new(()),
        }
    }
}

fn synthesize_edge_mp3(text: &str) -> Result<std::path::PathBuf, String> {
    use msedge_tts::tts::client::connect;
    use msedge_tts::tts::SpeechConfig;

    let config = SpeechConfig {
        // Natural online neural voice — no API key (Edge Read Aloud).
        voice_name: "zh-CN-XiaoxiaoNeural".into(),
        audio_format: "audio-24khz-48kbitrate-mono-mp3".into(),
        pitch: 0,
        rate: -8,
        volume: 0,
    };
    let mut client = connect().map_err(|e| format!("连接在线语音失败: {e}"))?;
    let audio = client
        .synthesize(text, &config)
        .map_err(|e| format!("在线语音合成失败: {e}"))?;
    let bytes = audio.audio_bytes;
    if bytes.is_empty() {
        return Err("在线语音返回为空".into());
    }
    let path = std::env::temp_dir().join(format!(
        "yinzhan-tts-{}-{}.mp3",
        std::process::id(),
        chrono::Utc::now().timestamp_millis()
    ));
    std::fs::write(&path, bytes).map_err(|e| format!("写入语音缓存失败: {e}"))?;
    Ok(path)
}

#[tauri::command]
pub async fn start_voice_assistant(app: AppHandle, state: State<'_, VoiceState>) -> Result<(), String> {
    let _guard = state
        .gate
        .lock()
        .map_err(|_| "语音助手正忙，请稍后重试".to_string())?;
    state.desired.store(true, Ordering::SeqCst);

    #[cfg(target_os = "macos")]
    {
        if macos::is_running() {
            return Ok(());
        }
        macos::start(app)?;
        return Ok(());
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err("当前系统暂不支持原生语音助手，请使用 macOS。".into())
    }
}

#[tauri::command]
pub async fn stop_voice_assistant(state: State<'_, VoiceState>) -> Result<(), String> {
    let _guard = state
        .gate
        .lock()
        .map_err(|_| "语音助手正忙，请稍后重试".to_string())?;
    state.desired.store(false, Ordering::SeqCst);

    #[cfg(target_os = "macos")]
    {
        macos::stop();
    }
    Ok(())
}

#[tauri::command]
pub async fn voice_assistant_info(state: State<'_, VoiceState>) -> Result<serde_json::Value, String> {
    let desired = state.desired.load(Ordering::SeqCst);
    #[cfg(target_os = "macos")]
    let running = macos::is_running();
    #[cfg(not(target_os = "macos"))]
    let running = false;

    Ok(serde_json::json!({
        "running": running,
        "desired": desired,
        "backend": if cfg!(target_os = "macos") { "macos-speech" } else { "none" },
        "wakeWord": "小栈小栈",
        "supported": cfg!(target_os = "macos"),
    }))
}

#[tauri::command]
pub async fn report_voice_web_status(
    app: AppHandle,
    state: State<'_, VoiceState>,
    status: String,
    detail: String,
) -> Result<(), String> {
    if status == "listening" || status == "starting" || status == "awake" {
        state.desired.store(true, Ordering::SeqCst);
    }
    if status == "stopped" || status == "error" {
        if status == "stopped" {
            state.desired.store(false, Ordering::SeqCst);
        }
    }
    let _ = app.emit("voice-status", VoiceStatusPayload { status, detail });
    Ok(())
}

/// Short acks (wake / 收到…) must be instant — Edge TTS often costs several seconds.
fn prefer_fast_system_tts(text: &str) -> bool {
    let n = text.chars().count();
    if n <= 18 {
        return true;
    }
    // Wake / transport acknowledgements even if slightly longer.
    text == "在呢"
        || text.starts_with("收到")
        || text.starts_with("好的")
        || text.starts_with("已")
}

/// Speak a Chinese reply. Short phrases use system TTS immediately; longer lines
/// prefer online neural voice (with a tight timeout) then fall back to system TTS.
#[tauri::command]
pub async fn voice_speak(text: String) -> Result<(), String> {
    let text = text.trim().to_string();
    if text.is_empty() {
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        if prefer_fast_system_tts(&text) {
            tokio::task::spawn_blocking(move || macos::speak(&text))
                .await
                .map_err(|e| format!("语音播报任务失败: {e}"))??;
            return Ok(());
        }

        let for_edge = text.clone();
        let edge = tokio::time::timeout(
            std::time::Duration::from_secs(3),
            tokio::task::spawn_blocking(move || synthesize_edge_mp3(&for_edge)),
        )
        .await;

        match edge {
            Ok(Ok(Ok(path))) => {
                let path_play = path.clone();
                let played = tokio::task::spawn_blocking(move || macos::play_mp3_file(&path_play))
                    .await
                    .map_err(|e| format!("播放语音任务失败: {e}"))?;
                let _ = std::fs::remove_file(&path);
                if played.is_ok() {
                    return Ok(());
                }
                eprintln!("neural tts playback failed: {played:?}");
            }
            Ok(Ok(Err(e))) => {
                eprintln!("neural tts synthesize failed: {e}");
            }
            Ok(Err(e)) => {
                eprintln!("neural tts task join failed: {e}");
            }
            Err(_) => {
                eprintln!("neural tts timed out; falling back to system voice");
            }
        }

        tokio::task::spawn_blocking(move || macos::speak(&text))
            .await
            .map_err(|e| format!("语音播报任务失败: {e}"))??;
        return Ok(());
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = text;
        Ok(())
    }
}

pub fn stop_on_exit(app: &AppHandle) {
    if let Some(state) = app.try_state::<VoiceState>() {
        state.desired.store(false, Ordering::SeqCst);
    }
    #[cfg(target_os = "macos")]
    macos::stop();
}
