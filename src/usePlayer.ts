import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { api } from "./api";
import {
  classifyPlayError,
  formatPlayError,
  mediaElementErrorMessage,
} from "./playErrors";
import { recordProviderFail, recordProviderOk } from "./providerHealth";
import { favKey } from "./trackMatch";
import type { RepeatMode, Track } from "./types";
import {
  QUEUE_STORAGE_KEY,
  clampSeekTime,
  loadStoredQueue,
  playbackDuration,
  readStoredRepeat,
  readStoredVolume,
  shuffleTracks,
} from "./playerUtils";

export type UsePlayerOptions = {
  onTrackStarted?: (track: Track) => void;
  onHealthChange?: () => void;
};

export function usePlayer(options: UsePlayerOptions = {}) {
  const { onTrackStarted, onHealthChange } = options;
  const onHealthChangeRef = useRef(onHealthChange);
  onHealthChangeRef.current = onHealthChange;
  const storedQueue = useMemo(() => loadStoredQueue(), []);

  const [queue, setQueue] = useState<Track[]>(() => storedQueue?.tracks ?? []);
  const [queueIndex, setQueueIndex] = useState(() => storedQueue?.index ?? -1);
  const [current, setCurrent] = useState<Track | null>(
    () =>
      storedQueue && storedQueue.index >= 0
        ? storedQueue.tracks[storedQueue.index] ?? null
        : null,
  );
  const [playing, setPlaying] = useState(false);
  const [loadingPlay, setLoadingPlay] = useState(false);
  const [playError, setPlayError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);

  const [shuffle, setShuffle] = useState(
    () => localStorage.getItem("yinzhan-shuffle") === "1",
  );
  const [repeatMode, setRepeatMode] = useState<RepeatMode>(readStoredRepeat);
  const [volume, setVolume] = useState(readStoredVolume);
  const [muted, setMuted] = useState(() => localStorage.getItem("yinzhan-muted") === "1");
  const [autoSkip, setAutoSkip] = useState(
    () => localStorage.getItem("yinzhan-auto-skip") !== "0",
  );

  const queueReadyRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<Track[]>(storedQueue?.tracks ?? []);
  const queueIndexRef = useRef(storedQueue?.index ?? -1);
  const shuffleRef = useRef(false);
  const repeatRef = useRef<RepeatMode>(readStoredRepeat());
  const playGenRef = useRef(0);
  const failSkipRef = useRef(0);
  const autoSkipRef = useRef(true);
  const ignoreEndedUntilRef = useRef(0);
  const suppressTimeRef = useRef(false);
  const playTrackAtRef = useRef<(tracks: Track[], index: number) => void>(() => undefined);
  const advanceRef = useRef<(dir: 1 | -1, opts?: { fromEnded?: boolean }) => void>(
    () => undefined,
  );
  const voiceDuckRef = useRef(1);
  const voiceHoldPlayingRef = useRef(false);

  const currentKey = current ? favKey(current) : null;
  const hasPrev = queue.length > 0 && (queueIndex > 0 || repeatMode === "all" || shuffle);
  const hasNext =
    queue.length > 0 &&
    (queueIndex < queue.length - 1 || repeatMode === "all" || repeatMode === "one" || shuffle);

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  useEffect(() => {
    queueIndexRef.current = queueIndex;
  }, [queueIndex]);

  useEffect(() => {
    shuffleRef.current = shuffle;
  }, [shuffle]);

  useEffect(() => {
    repeatRef.current = repeatMode;
  }, [repeatMode]);

  useEffect(() => {
    autoSkipRef.current = autoSkip;
    localStorage.setItem("yinzhan-auto-skip", autoSkip ? "1" : "0");
  }, [autoSkip]);

  useEffect(() => {
    localStorage.setItem("yinzhan-shuffle", shuffle ? "1" : "0");
  }, [shuffle]);

  useEffect(() => {
    localStorage.setItem("yinzhan-repeat-v2", repeatMode);
  }, [repeatMode]);

  useEffect(() => {
    if (!queueReadyRef.current) {
      queueReadyRef.current = true;
      return;
    }
    if (queue.length === 0) {
      localStorage.removeItem(QUEUE_STORAGE_KEY);
      return;
    }
    localStorage.setItem(
      QUEUE_STORAGE_KEY,
      JSON.stringify({ tracks: queue, index: queueIndex }),
    );
  }, [queue, queueIndex]);

  const applyVolume = useCallback((vol: number, isMuted: boolean) => {
    const audio = audioRef.current;
    if (audio) audio.volume = isMuted ? 0 : vol * voiceDuckRef.current;
  }, []);

  const onVoiceMusicDuck = useCallback(
    (factor: number) => {
      voiceDuckRef.current = Math.min(1, Math.max(0.08, factor));
      applyVolume(volume, muted);
    },
    [applyVolume, volume, muted],
  );

  const playTrackAt = useCallback(async (tracks: Track[], index: number) => {
    const track = tracks[index];
    const audio = audioRef.current;
    if (!track || !audio) return;

    const gen = ++playGenRef.current;
    failSkipRef.current = 0;
    setQueue(tracks);
    setQueueIndex(index);
    queueRef.current = tracks;
    queueIndexRef.current = index;
    setCurrent(track);
    setLoadingPlay(true);
    setPlaying(false);
    setPlayError(null);
    suppressTimeRef.current = true;
    setProgress(0);
    setDuration(track.durationMs ? track.durationMs / 1000 : 0);
    // Soft stop only — removeAttribute+load tears down WebKit's audio unit and
    // races macOS CoreAudio / AVAudioEngine (voice mic), causing SIGSEGV.
    try {
      audio.pause();
    } catch {
      // ignore
    }

    try {
      const resolved = await api.resolvePlayUrl(track);
      if (gen !== playGenRef.current) return;
      const src = resolved.localPath
        ? convertFileSrc(resolved.localPath)
        : resolved.url;
      if (!src) {
        throw new Error("未获取到可播地址");
      }
      audio.src = src;
      try {
        await audio.play();
      } catch {
        // One retry without reload() — load() re-enters CoreAudio teardown.
        if (gen !== playGenRef.current) return;
        await new Promise((r) => window.setTimeout(r, 120));
        if (gen !== playGenRef.current) return;
        await audio.play();
      }
      if (gen !== playGenRef.current) return;
      failSkipRef.current = 0;
      suppressTimeRef.current = false;
      setProgress(audio.currentTime || 0);
      recordProviderOk(track.provider);
      onHealthChangeRef.current?.();
      void api.addPlayHistory(track).then(() => {
        if (gen === playGenRef.current) {
          onTrackStarted?.(track);
        }
      });
    } catch (e) {
      if (gen !== playGenRef.current) return;
      suppressTimeRef.current = false;
      setPlaying(false);
      const errInfo = classifyPlayError(e, track.provider);
      recordProviderFail(track.provider, errInfo.message);
      onHealthChangeRef.current?.();
      setPlayError(formatPlayError(errInfo));
      const canAdvance = index < tracks.length - 1 || repeatRef.current === "all";
      if (autoSkipRef.current && canAdvance && failSkipRef.current < 3) {
        failSkipRef.current += 1;
        // Slightly longer gap so HAL can settle between failed resolves.
        window.setTimeout(() => {
          if (gen === playGenRef.current) {
            advanceRef.current(1);
          }
        }, 900);
      } else if (autoSkipRef.current && failSkipRef.current >= 3) {
        setPlayError("连续多首无法播放，已暂停");
        failSkipRef.current = 0;
      }
    } finally {
      if (gen === playGenRef.current) {
        setLoadingPlay(false);
      }
    }
  }, [onTrackStarted]);

  useEffect(() => {
    playTrackAtRef.current = playTrackAt;
  }, [playTrackAt]);

  const advance = useCallback(
    (dir: 1 | -1, opts?: { fromEnded?: boolean }) => {
      const q = queueRef.current;
      const i = queueIndexRef.current;
      const mode = repeatRef.current;
      if (q.length === 0 || i < 0) return;

      if (opts?.fromEnded && mode === "one") {
        void playTrackAt(q, i);
        return;
      }

      if (shuffleRef.current && q.length > 1) {
        let next = Math.floor(Math.random() * q.length);
        while (next === i) next = Math.floor(Math.random() * q.length);
        void playTrackAt(q, next);
        return;
      }

      let next = i + dir;
      if (next < 0 || next >= q.length) {
        if (mode === "all") {
          next = (next + q.length) % q.length;
        } else {
          return;
        }
      }
      void playTrackAt(q, next);
    },
    [playTrackAt],
  );

  useEffect(() => {
    advanceRef.current = advance;
  }, [advance]);

  useEffect(() => {
    const audio = new Audio();
    audio.preload = "metadata";
    audio.volume = muted ? 0 : volume;
    audioRef.current = audio;

    const onTime = () => {
      if (suppressTimeRef.current) return;
      setProgress(audio.currentTime);
    };
    const onMeta = () => {
      const d = playbackDuration(audio);
      if (d > 0) setDuration(d);
    };
    const onDuration = () => {
      const d = playbackDuration(audio);
      if (d > 0) setDuration(d);
    };
    const onEnded = () => {
      if (Date.now() < ignoreEndedUntilRef.current) return;
      const dur = playbackDuration(audio);
      if (dur > 0 && audio.currentTime < dur - 1.5) return;
      setPlaying(false);
      advanceRef.current(1, { fromEnded: true });
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onErr = () => {
      const gen = playGenRef.current;
      const track = queueRef.current[queueIndexRef.current];
      setPlaying(false);
      const errInfo = classifyPlayError(
        mediaElementErrorMessage(audio),
        track?.provider,
      );
      if (track) {
        recordProviderFail(track.provider, errInfo.message);
        onHealthChangeRef.current?.();
      }
      if (!autoSkipRef.current) {
        setPlayError(formatPlayError(errInfo));
        return;
      }
      setPlayError(`${formatPlayError(errInfo)}，尝试下一首…`);
      if (failSkipRef.current >= 3) {
        setPlayError("连续多首无法播放，已暂停");
        failSkipRef.current = 0;
        return;
      }
      failSkipRef.current += 1;
      window.setTimeout(() => {
        if (gen === playGenRef.current) {
          advanceRef.current(1);
        }
      }, 900);
    };

    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("durationchange", onDuration);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("error", onErr);

    return () => {
      try {
        audio.pause();
        audio.removeAttribute("src");
      } catch {
        // ignore
      }
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("durationchange", onDuration);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("error", onErr);
      audioRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    applyVolume(volume, muted);
    localStorage.setItem("yinzhan-volume", String(volume));
    localStorage.setItem("yinzhan-muted", muted ? "1" : "0");
  }, [volume, muted, applyVolume]);

  const onVoiceMusicHold = useCallback((hold: boolean, resume = true) => {
    const audio = audioRef.current;
    if (!audio) return;
    if (hold) {
      voiceHoldPlayingRef.current = !audio.paused;
      if (!audio.paused) audio.pause();
      return;
    }
    if (resume && voiceHoldPlayingRef.current) {
      void audio.play().catch(() => undefined);
    }
    voiceHoldPlayingRef.current = false;
  }, []);

  const playFromList = useCallback(
    (track: Track, list: Track[]) => {
      const index = list.findIndex(
        (t) => t.id === track.id && t.provider === track.provider,
      );
      const start = index >= 0 ? index : 0;
      const ordered = shuffleRef.current ? shuffleTracks(list, start) : list;
      const playIndex = shuffleRef.current ? 0 : start;
      void playTrackAt(ordered, playIndex);
    },
    [playTrackAt],
  );

  const playAll = useCallback(
    (list: Track[]) => {
      if (list.length === 0) return;
      const ordered = shuffleRef.current ? shuffleTracks(list, 0) : list;
      void playTrackAt(ordered, 0);
    },
    [playTrackAt],
  );

  const enqueueNext = useCallback((track: Track) => {
    const q = queueRef.current;
    const i = queueIndexRef.current;
    if (q.length === 0 || i < 0) {
      void playTrackAtRef.current([track], 0);
      return;
    }
    const next = [...q.slice(0, i + 1), track, ...q.slice(i + 1)];
    setQueue(next);
    queueRef.current = next;
  }, []);

  const addToQueue = useCallback((track: Track) => {
    const q = queueRef.current;
    if (q.length === 0 || queueIndexRef.current < 0) {
      void playTrackAtRef.current([track], 0);
      return;
    }
    const next = [...q, track];
    setQueue(next);
    queueRef.current = next;
  }, []);

  const removeFromQueue = useCallback(
    (index: number) => {
      const q = queueRef.current;
      const i = queueIndexRef.current;
      if (index < 0 || index >= q.length) return;

      const next = q.filter((_, idx) => idx !== index);
      if (next.length === 0) {
        const audio = audioRef.current;
        if (audio) {
          try {
            audio.pause();
          } catch {
            // ignore
          }
        }
        setQueue([]);
        setQueueIndex(-1);
        queueRef.current = [];
        queueIndexRef.current = -1;
        setCurrent(null);
        setPlaying(false);
        setProgress(0);
        setDuration(0);
        return;
      }

      if (index === i) {
        const newIndex = Math.min(index, next.length - 1);
        void playTrackAt(next, newIndex);
        return;
      }

      const newIndex = index < i ? i - 1 : i;
      setQueue(next);
      setQueueIndex(newIndex);
      queueRef.current = next;
      queueIndexRef.current = newIndex;
    },
    [playTrackAt],
  );

  const clearQueueKeepCurrent = useCallback(() => {
    const q = queueRef.current;
    const i = queueIndexRef.current;
    if (i < 0 || !q[i]) {
      setQueue([]);
      setQueueIndex(-1);
      queueRef.current = [];
      queueIndexRef.current = -1;
      return;
    }
    const only = [q[i]];
    setQueue(only);
    setQueueIndex(0);
    queueRef.current = only;
    queueIndexRef.current = 0;
  }, []);

  const playPrev = useCallback(() => {
    const audio = audioRef.current;
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      setProgress(0);
      return;
    }
    advance(-1);
  }, [advance]);

  const playPrevTrack = useCallback(() => {
    advance(-1);
  }, [advance]);

  const playNext = useCallback(() => {
    advance(1);
  }, [advance]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !current) return;
    if (audio.paused) {
      if (!audio.getAttribute("src") && queueRef.current.length > 0 && queueIndexRef.current >= 0) {
        void playTrackAtRef.current(queueRef.current, queueIndexRef.current);
        return;
      }
      void audio.play().catch(() => setPlayError("无法继续播放"));
    } else {
      audio.pause();
    }
  }, [current]);

  const onSeek = useCallback(
    (ratio: number) => {
      const audio = audioRef.current;
      if (!audio) return;
      const dur = playbackDuration(audio, current?.durationMs);
      if (dur <= 0) return;
      const target = clampSeekTime(audio, dur * Math.min(1, Math.max(0, ratio)));
      ignoreEndedUntilRef.current = Date.now() + 800;
      try {
        audio.currentTime = target;
        setProgress(target);
      } catch {
        // Some streams reject seeks; don't advance the queue.
      }
    },
    [current],
  );

  const seekToSeconds = useCallback((sec: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const target = clampSeekTime(audio, sec);
    ignoreEndedUntilRef.current = Date.now() + 800;
    try {
      audio.currentTime = target;
      setProgress(target);
    } catch {
      // ignore
    }
  }, []);

  const toggleShuffle = useCallback(() => {
    setShuffle((on) => {
      const next = !on;
      if (next && queueRef.current.length > 1 && queueIndexRef.current >= 0) {
        const reshuffled = shuffleTracks(queueRef.current, queueIndexRef.current);
        setQueue(reshuffled);
        setQueueIndex(0);
        queueRef.current = reshuffled;
        queueIndexRef.current = 0;
      }
      return next;
    });
  }, []);

  const cycleRepeat = useCallback(() => {
    setRepeatMode((m) => (m === "off" ? "all" : m === "all" ? "one" : "off"));
  }, []);

  const setVolumeSafe = useCallback((v: number) => {
    const clamped = Math.min(1, Math.max(0, v));
    setVolume(clamped);
    if (clamped > 0) setMuted(false);
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((m) => !m);
  }, []);

  const setQueueAndRef = useCallback((next: Track[]) => {
    setQueue(next);
    queueRef.current = next;
  }, []);

  return {
    queue,
    queueIndex,
    current,
    playing,
    loadingPlay,
    playError,
    setPlayError,
    progress,
    duration,
    setProgress,
    shuffle,
    repeatMode,
    volume,
    muted,
    autoSkip,
    currentKey,
    hasPrev,
    hasNext,
    audioRef,
    queueRef,
    queueIndexRef,
    playTrackAtRef,
    ignoreEndedUntilRef,
    playTrackAt,
    advance,
    playFromList,
    playAll,
    enqueueNext,
    addToQueue,
    removeFromQueue,
    clearQueueKeepCurrent,
    playPrev,
    playPrevTrack,
    playNext,
    togglePlay,
    onSeek,
    seekToSeconds,
    toggleShuffle,
    cycleRepeat,
    setVolume: setVolumeSafe,
    setVolumeLevel: setVolume,
    setMuted,
    toggleMute,
    setAutoSkip,
    setQueue: setQueueAndRef,
    applyVolume,
    onVoiceMusicDuck,
    onVoiceMusicHold,
  };
}
