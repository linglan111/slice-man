import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import type { Job, Segment } from '../../../shared/contracts';
import { primarySubtitleText } from '../../../shared/subtitle-content';
import { useVideoClock } from '../hooks/useVideoClock';
import { activeCaptions, captionLines, captionOpacity, emphasizedParts, nativeCaptionText } from '../lib/live-captions';

type Props = { job: Job; source: string; videoRef: RefObject<HTMLVideoElement | null>; onTimeUpdate: (timeMs: number) => void; onError: () => void; isBusy?: boolean; onEdit?: (segment: Segment) => void; onActiveChange?: (ids: string[]) => void };

export function LiveVideoPreview({ job, source, videoRef, onTimeUpdate, onError, isBusy = false, onEdit, onActiveChange }: Props): ReactNode {
  const clock = useVideoClock(videoRef, source);
  const [isNativeFullscreen, setIsNativeFullscreen] = useState(false);
  const nativeTrackRef = useRef<TextTrack | null>(null);
  const style = job.style;
  const active = useMemo(() => clock.hasFrame && !clock.isSeeking ? activeCaptions(job.segments, clock.timeMs) : [], [job.segments, clock.timeMs, clock.hasFrame, clock.isSeeking]);
  const activeKey = JSON.stringify(active.map((segment) => segment.id));
  useEffect(() => { onActiveChange?.(JSON.parse(activeKey) as string[]); }, [activeKey, onActiveChange]);
  useEffect(() => () => { onActiveChange?.([]); }, [onActiveChange]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const track = nativeTrackRef.current ?? video.addTextTrack('subtitles', '实时字幕', job.options.translationEnabled ? job.options.targetLanguage : job.options.sourceLanguage);
    nativeTrackRef.current = track;
    track.mode = 'disabled';
    let hasPlayableFrame = video.readyState >= 2 && !video.error;
    const installedCues: VTTCue[] = [];
    for (const segment of job.segments) {
      const cue = new VTTCue(segment.startMs / 1000, segment.endMs / 1000, nativeCaptionText(segment, job.options.bilingual, job.options.translationEnabled));
      cue.id = segment.id;
      track.addCue(cue);
      installedCues.push(cue);
    }
    const fullscreen = (): void => {
      const isFullscreen = document.fullscreenElement === video;
      const mode = isFullscreen && hasPlayableFrame ? 'showing' : 'disabled';
      if (track.mode !== mode) track.mode = mode;
      setIsNativeFullscreen(isFullscreen);
    };
    document.addEventListener('fullscreenchange', fullscreen);
    video.textTracks.addEventListener('change', fullscreen);
    const unavailable = (): void => { hasPlayableFrame = false; fullscreen(); };
    const available = (): void => { hasPlayableFrame = true; fullscreen(); };
    video.addEventListener('error', unavailable);
    video.addEventListener('emptied', unavailable);
    video.addEventListener('loadeddata', available);
    fullscreen();
    return () => {
      document.removeEventListener('fullscreenchange', fullscreen);
      video.textTracks.removeEventListener('change', fullscreen);
      video.removeEventListener('error', unavailable);
      video.removeEventListener('emptied', unavailable);
      video.removeEventListener('loadeddata', available);
      track.mode = 'disabled';
      // TextTracks cannot be removed; reuse this one on edits to avoid buildup.
      // Chromium exposes null cues while disabled; keep the references we added.
      for (const cue of installedCues) track.removeCue(cue);
    };
  }, [videoRef, job.segments, job.options.bilingual, job.options.translationEnabled, job.options.targetLanguage, job.options.sourceLanguage, source]);

  const height = clock.rect.height;
  const fontSize = height * style.fontSizeRatio;
  const outline = height * style.outlineWidthRatio;
  const shadowColor = `${style.shadow.color}${Math.round(style.shadow.opacity * 255).toString(16).padStart(2, '0')}`;
  const captionStyle: CSSProperties = {
    width: `${style.layout.maxWidthRatio * 100}%`, color: style.textColor, fontSize,
    fontFamily: '"Noto Sans CJK SC", "Microsoft YaHei", sans-serif', fontWeight: style.fontId === 'managed-cjk-bold' ? 700 : 400,
    WebkitTextStroke: `${outline}px ${style.outlineColor}`, paintOrder: 'stroke fill',
    textShadow: `${height * style.shadow.offsetXRatio}px ${height * style.shadow.offsetYRatio}px ${Math.max(1, outline)}px ${shadowColor}`,
    ...(style.layout.anchor === 'center' ? { top: '50%', transform: 'translate(-50%, -50%)' } : style.layout.anchor === 'top-center' ? { top: `${style.layout.marginBottomRatio * 100}%` } : { bottom: `max(${style.layout.marginBottomRatio * 100}%, 64px)` }),
  };
  return <div className="live-video-player">
    <video ref={videoRef} src={source} controls onTimeUpdate={(event) => onTimeUpdate(Math.round(event.currentTarget.currentTime * 1000))} onSeeked={(event) => onTimeUpdate(Math.round(event.currentTarget.currentTime * 1000))} onError={onError} />
    {!isNativeFullscreen && <div className="live-captions" data-testid="live-captions" aria-label="实时字幕" style={clock.rect}>
      <div className="live-captions__stack" style={captionStyle}>{active.map((segment) => {
        const keywords = style.emphasisBySegment.find((item) => item.segmentId === segment.id)?.keywords ?? [];
        return <button type="button" className="live-captions__cue" key={segment.id} data-cue-id={segment.id} aria-label={`校对画面字幕：${primarySubtitleText(segment, job.options.translationEnabled)}`} disabled={isBusy || !onEdit} style={{ opacity: captionOpacity(segment, clock.timeMs, style.animation) }} onClick={() => {
          if (isBusy || !onEdit || clock.isSeeking) return;
          videoRef.current?.pause();
          onEdit(segment);
        }}>
          {captionLines(segment, job.options.bilingual, job.options.translationEnabled).map((line, index) => <span key={index} className="live-captions__line" style={{ fontSize: line.isSource ? fontSize * style.layout.sourceScale : fontSize }}>
            {emphasizedParts(line.text, line.isSource ? [] : keywords).map((part, partIndex) => <span key={partIndex} style={part.isEmphasized ? { color: style.emphasisColor } : undefined}>{part.text}</span>)}
          </span>)}
        </button>;
      })}</div>
    </div>}
  </div>;
}
