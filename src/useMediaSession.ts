import { useEffect, type MutableRefObject, type RefObject } from "react";
import { providerLabel } from "./api";
import { clampSeekTime } from "./playerUtils";
import type { Track } from "./types";

type Options = {
  current: Track | null;
  playing: boolean;
  progress: number;
  duration: number;
  audioRef: RefObject<HTMLAudioElement | null>;
  ignoreEndedUntilRef: MutableRefObject<number>;
  onPrev: () => void;
  onNext: () => void;
  onProgress: (sec: number) => void;
};

/** Wire Media Session metadata, action handlers, and lock-screen scrubber. */
export function useMediaSession({
  current,
  playing,
  progress,
  duration,
  audioRef,
  ignoreEndedUntilRef,
  onPrev,
  onNext,
  onProgress,
}: Options) {
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;

    if (!current) {
      navigator.mediaSession.metadata = null;
      try {
        navigator.mediaSession.setPositionState?.();
      } catch {
        // clear not supported
      }
      return;
    }

    const artwork = current.coverUrl
      ? [{ src: current.coverUrl, sizes: "300x300", type: "image/jpeg" }]
      : [];

    navigator.mediaSession.metadata = new MediaMetadata({
      title: current.title,
      artist: current.artist,
      album: current.album ?? providerLabel(current.provider),
      artwork,
    });
    navigator.mediaSession.playbackState = playing ? "playing" : "paused";
  }, [current, playing]);

  useEffect(() => {
    if (!("mediaSession" in navigator) || !current) return;
    if (!Number.isFinite(duration) || duration <= 0) return;

    // Throttle scrubber sync — timeupdate fires too often for Media Session.
    const position = Math.min(Math.max(0, progress), duration);
    const timer = window.setTimeout(() => {
      try {
        navigator.mediaSession.setPositionState({
          duration,
          playbackRate: 1,
          position,
        });
      } catch {
        // unsupported or invalid range on some platforms
      }
    }, 400);

    return () => window.clearTimeout(timer);
  }, [current, duration, progress, playing]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;

    const setHandler = (
      action: MediaSessionAction,
      handler: MediaSessionActionHandler | null,
    ) => {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // unsupported action on this platform
      }
    };

    setHandler("play", () => {
      const audio = audioRef.current;
      if (audio) void audio.play().catch(() => undefined);
    });
    setHandler("pause", () => {
      audioRef.current?.pause();
    });
    setHandler("previoustrack", () => onPrev());
    setHandler("nexttrack", () => onNext());
    setHandler("seekto", (details) => {
      const audio = audioRef.current;
      if (!audio || details.seekTime == null) return;
      const target = clampSeekTime(audio, details.seekTime);
      ignoreEndedUntilRef.current = Date.now() + 800;
      audio.currentTime = target;
      onProgress(target);
    });

    return () => {
      setHandler("play", null);
      setHandler("pause", null);
      setHandler("previoustrack", null);
      setHandler("nexttrack", null);
      setHandler("seekto", null);
    };
  }, [audioRef, ignoreEndedUntilRef, onNext, onPrev, onProgress]);
}
