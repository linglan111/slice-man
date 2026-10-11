import { useEffect, useState, type RefObject } from 'react';
import { containedVideoRect, type VideoRect } from '../lib/live-captions';

type VideoClock = { timeMs: number; isSeeking: boolean; hasFrame: boolean; rect: VideoRect };
const EMPTY_RECT: VideoRect = { left: 0, top: 0, width: 0, height: 0 };

/** Frame-rate updates are contained in the preview, never sent to the workspace. */
export function useVideoClock(videoRef: RefObject<HTMLVideoElement | null>, source: string): VideoClock {
  const [clock, setClock] = useState<VideoClock>({ timeMs: 0, isSeeking: false, hasFrame: false, rect: EMPTY_RECT });
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let isCurrent = true;
    let frameId: number | undefined;
    let animationId: number | undefined;
    const update = (time = video.currentTime): void => {
      if (!isCurrent) return;
      setClock((previous) => ({ ...previous, timeMs: time * 1000, isSeeking: video.seeking, hasFrame: video.readyState >= 2 && !video.error }));
    };
    const resize = (): void => {
      if (!isCurrent) return;
      const bounds = video.getBoundingClientRect();
      const rect = containedVideoRect(bounds.width, bounds.height, video.videoWidth, video.videoHeight);
      setClock((previous) => ({ ...previous, rect }));
    };
    const stop = (): void => {
      if (frameId !== undefined) video.cancelVideoFrameCallback(frameId);
      if (animationId !== undefined) cancelAnimationFrame(animationId);
      frameId = undefined; animationId = undefined;
    };
    const frame = (_now: number, metadata: VideoFrameCallbackMetadata): void => {
      frameId = undefined;
      // A paused seek can decode the frame just before its settled media position.
      // Use actual currentTime there so a time-button jump includes the cue start.
      update(video.paused ? video.currentTime : metadata.mediaTime);
      if (isCurrent && !video.paused && !video.ended) frameId = video.requestVideoFrameCallback(frame);
    };
    const fallback = (): void => {
      animationId = undefined;
      update();
      if (isCurrent && !video.paused && !video.ended) animationId = requestAnimationFrame(fallback);
    };
    const start = (): void => {
      stop();
      if (typeof video.requestVideoFrameCallback === 'function') frameId = video.requestVideoFrameCallback(frame);
      else if (!video.paused && !video.ended) animationId = requestAnimationFrame(fallback);
    };
    const ready = (): void => { resize(); update(); start(); };
    const pause = (): void => { stop(); update(); };
    const seeking = (): void => { stop(); update(); };
    const emptied = (): void => { stop(); setClock({ timeMs: 0, isSeeking: false, hasFrame: false, rect: EMPTY_RECT }); };
    const events: [string, () => void][] = [['loadedmetadata', resize], ['loadeddata', ready], ['resize', resize], ['play', start], ['pause', pause], ['ended', pause], ['seeking', seeking], ['seeked', ready], ['emptied', emptied], ['error', emptied]];
    for (const [name, callback] of events) video.addEventListener(name, callback);
    const observer = new ResizeObserver(resize);
    observer.observe(video);
    ready();
    return () => {
      isCurrent = false; stop(); observer.disconnect();
      for (const [name, callback] of events) video.removeEventListener(name, callback);
    };
  }, [videoRef, source]);
  return clock;
}
