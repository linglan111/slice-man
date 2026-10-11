// @vitest-environment jsdom
import { createRef } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_STYLE, optionsSchema, type Job } from '../../../src/shared/contracts';
import { LiveVideoPreview } from '../../../src/renderer/src/components/LiveVideoPreview';

function fixtureJob(): Job {
  const idle = { state: 'idle' as const, progress: 0, message: '' };
  return {
    id: 'anonymous', name: 'Anonymous', inputPath: 'unused', revision: 1, createdAt: 1, updatedAt: 1,
    media: { durationMs: 4000, width: 640, height: 360, hasAudio: true, audioOffsetMs: 0, rotation: 0, sampleAspectRatio: '1:1' },
    options: optionsSchema.parse({}), style: { ...DEFAULT_STYLE, animation: { type: 'none', inMs: 0, outMs: 0 } },
    segments: [{ id: 'first', startMs: 100, endMs: 1800, sourceText: '<b>Source & literal</b>', translatedText: '', translationStale: false }, { id: 'second', startMs: 2000, endMs: 3800, sourceText: 'Second', translatedText: '', translationStale: false }],
    stages: { recognize: { ...idle, state: 'succeeded' }, translate: { ...idle }, style: { ...idle }, preview: { ...idle }, export: { ...idle } }, outputs: [],
  };
}

let frameCallback: VideoFrameRequestCallback | undefined;
let disconnected = vi.fn<() => void>();
let cancelFrame = vi.fn<(id: number) => void>();
let addTrack = vi.fn<() => typeof track>();
let track: { mode: TextTrackMode; cues: VTTCue[]; addCue: (cue: VTTCue) => void; removeCue: (cue: VTTCue) => void };

beforeEach(() => {
  frameCallback = undefined;
  disconnected = vi.fn(); cancelFrame = vi.fn();
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void { disconnected(); } });
  vi.stubGlobal('VTTCue', class { constructor(public startTime: number, public endTime: number, public text: string) {} });
  track = { mode: 'disabled', cues: [], addCue: (cue) => { track.cues.push(cue); }, removeCue: (cue) => { track.cues = track.cues.filter((item) => item !== cue); } };
  addTrack = vi.fn(() => track);
  Object.defineProperties(HTMLVideoElement.prototype, {
    readyState: { configurable: true, get: () => 2 }, videoWidth: { configurable: true, get: () => 360 }, videoHeight: { configurable: true, get: () => 640 },
    clientWidth: { configurable: true, get: () => 640 }, clientHeight: { configurable: true, get: () => 360 },
    requestVideoFrameCallback: { configurable: true, value: vi.fn((callback: VideoFrameRequestCallback) => { frameCallback = callback; return 1; }) },
    cancelVideoFrameCallback: { configurable: true, value: cancelFrame }, addTextTrack: { configurable: true, value: addTrack },
    textTracks: { configurable: true, value: new EventTarget() },
    getBoundingClientRect: { configurable: true, value: () => new DOMRect(0, 0, 640, 360) },
  });
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function seek(video: HTMLVideoElement, seconds: number): void {
  video.currentTime = seconds;
  fireEvent(video, new Event('seeked'));
}

describe('live video caption rendering and lifecycle', () => {
  it('renders literal source, follows actual seek/pause time and fits portrait content', () => {
    const videoRef = createRef<HTMLVideoElement>();
    render(<LiveVideoPreview job={fixtureJob()} source="app-media://local/anonymous" videoRef={videoRef} onTimeUpdate={vi.fn()} onError={vi.fn()} />);
    const video = videoRef.current;
    if (!video) throw new Error('Video missing');
    seek(video, .5);
    const overlay = screen.getByTestId('live-captions');
    expect(overlay.textContent).toBe('<b>Source & literal</b>');
    expect(overlay.querySelector('b')).toBeNull();
    expect(overlay.style.left).toBe('218.75px');
    expect(overlay.style.width).toBe('202.5px');
    seek(video, 1.8);
    expect(overlay.textContent).toBe('');
    seek(video, 2.1); fireEvent.pause(video);
    expect(overlay.textContent).toBe('Second');
    seek(video, .5);
    expect(overlay.textContent).toBe('<b>Source & literal</b>');
  });

  it('uses presented frame timestamps without firing workspace updates for every frame', () => {
    const videoRef = createRef<HTMLVideoElement>(); const onTimeUpdate = vi.fn();
    render(<LiveVideoPreview job={fixtureJob()} source="app-media://local/anonymous" videoRef={videoRef} onTimeUpdate={onTimeUpdate} onError={vi.fn()} />);
    if (!videoRef.current) throw new Error('Video missing');
    Object.defineProperty(videoRef.current, 'paused', { configurable: true, value: false });
    act(() => { frameCallback?.(0, { mediaTime: 2.1 } as VideoFrameCallbackMetadata); });
    expect(screen.getByTestId('live-captions').textContent).toBe('Second');
    expect(onTimeUpdate).not.toHaveBeenCalled();
  });

  it('retains paused exact start and end boundaries when the decoded frame precedes the settled media position', () => {
    const videoRef = createRef<HTMLVideoElement>();
    render(<LiveVideoPreview job={fixtureJob()} source="app-media://local/anonymous" videoRef={videoRef} onTimeUpdate={vi.fn()} onError={vi.fn()} />);
    const video = videoRef.current;
    if (!video) throw new Error('Video missing');
    Object.defineProperty(video, 'paused', { configurable: true, value: true });
    seek(video, .1);
    act(() => { frameCallback?.(0, { mediaTime: .08 } as VideoFrameCallbackMetadata); });
    expect(screen.getByTestId('live-captions').textContent).toBe('<b>Source & literal</b>');
    seek(video, 1.8);
    act(() => { frameCallback?.(0, { mediaTime: 1.76 } as VideoFrameCallbackMetadata); });
    expect(screen.getByTestId('live-captions').textContent).toBe('');
  });

  it('resizes the portrait caption rectangle and typography with the displayed video bounds', () => {
    const videoRef = createRef<HTMLVideoElement>();
    render(<LiveVideoPreview job={fixtureJob()} source="app-media://local/anonymous" videoRef={videoRef} onTimeUpdate={vi.fn()} onError={vi.fn()} />);
    const video = videoRef.current;
    if (!video) throw new Error('Video missing');
    seek(video, .5);
    const overlay = screen.getByTestId('live-captions');
    expect((overlay.querySelector('.live-captions__stack') as HTMLElement).style.fontSize).toBe('16.2px');
    Object.defineProperty(video, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect(0, 0, 320, 180) });
    fireEvent(video, new Event('resize'));
    expect(overlay.style.left).toBe('109.375px');
    expect(overlay.style.width).toBe('101.25px');
    expect(overlay.style.height).toBe('180px');
    expect((overlay.querySelector('.live-captions__stack') as HTMLElement).style.fontSize).toBe('8.1px');
    expect(overlay.textContent).toBe('<b>Source & literal</b>');
  });

  it('updates text/bilingual/style/timing while paused and reuses one disabled inline track', () => {
    const job = fixtureJob(); const videoRef = createRef<HTMLVideoElement>();
    const props = { source: 'app-media://local/anonymous', videoRef, onTimeUpdate: vi.fn(), onError: vi.fn() };
    const view = render(<LiveVideoPreview {...props} job={job} />);
    const video = videoRef.current;
    if (!video) throw new Error('Video missing');
    seek(video, .5);
    const next = { ...job, options: { ...job.options, bilingual: true }, style: { ...job.style, textColor: '#AABBCC', emphasisBySegment: [{ segmentId: 'first', keywords: ['Target'] }] }, segments: job.segments.map((cue) => cue.id === 'first' ? { ...cue, translatedText: 'Target words' } : cue) };
    view.rerender(<LiveVideoPreview {...props} job={next} />);
    const overlay = screen.getByTestId('live-captions');
    expect(overlay.textContent).toBe('Target words<b>Source & literal</b>');
    expect(overlay.querySelector('.live-captions__stack')?.getAttribute('style')).toContain('rgb(170, 187, 204)');
    expect(addTrack).toHaveBeenCalledOnce();
    expect(track.mode).toBe('disabled');
    track.mode = 'showing';
    act(() => { video.textTracks.dispatchEvent(new Event('change')); });
    expect(track.mode).toBe('disabled');
    expect(track.cues).toHaveLength(2);
    view.rerender(<LiveVideoPreview {...props} job={{ ...next, segments: next.segments.map((cue) => ({ ...cue, startMs: cue.startMs + 1000, endMs: cue.endMs + 1000 })) }} />);
    expect(overlay.textContent).toBe('');
  });

  it('shows native fullscreen cues only there and clears tracks, observers and frame work on unmount', () => {
    const videoRef = createRef<HTMLVideoElement>();
    const view = render(<LiveVideoPreview job={fixtureJob()} source="app-media://local/anonymous" videoRef={videoRef} onTimeUpdate={vi.fn()} onError={vi.fn()} />);
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: videoRef.current });
    fireEvent(document, new Event('fullscreenchange'));
    expect(track.mode).toBe('showing');
    expect(screen.queryByTestId('live-captions')).toBeNull();
    expect(track.cues[0]?.text).toBe('&lt;b&gt;Source &amp; literal&lt;/b&gt;');
    if (!videoRef.current) throw new Error('Video missing');
    fireEvent.error(videoRef.current);
    expect(track.mode).toBe('disabled');
    fireEvent.loadedData(videoRef.current);
    expect(track.mode).toBe('showing');
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
    fireEvent(document, new Event('fullscreenchange'));
    expect(track.mode).toBe('disabled');
    view.unmount();
    expect(track.cues).toHaveLength(0);
    expect(cancelFrame).toHaveBeenCalled();
    expect(disconnected).toHaveBeenCalledOnce();
    act(() => { frameCallback?.(0, { mediaTime: .5 } as VideoFrameCallbackMetadata); });
  });

  it('hides old captions during seeking and after a media error', () => {
    const videoRef = createRef<HTMLVideoElement>(); const onError = vi.fn();
    render(<LiveVideoPreview job={fixtureJob()} source="app-media://local/anonymous" videoRef={videoRef} onTimeUpdate={vi.fn()} onError={onError} />);
    const video = videoRef.current;
    if (!video) throw new Error('Video missing');
    seek(video, .5);
    Object.defineProperty(video, 'seeking', { configurable: true, value: true });
    fireEvent(video, new Event('seeking'));
    expect(screen.getByTestId('live-captions').textContent).toBe('');
    Object.defineProperty(video, 'seeking', { configurable: true, value: false });
    seek(video, .5);
    Object.defineProperty(video, 'error', { configurable: true, value: { code: 3 } });
    fireEvent.error(video);
    expect(screen.getByTestId('live-captions').textContent).toBe('');
    fireEvent.pause(video);
    act(() => { frameCallback?.(0, { mediaTime: .5 } as VideoFrameCallbackMetadata); });
    expect(screen.getByTestId('live-captions').textContent).toBe('');
    expect(onError).toHaveBeenCalledOnce();
  });

  it('cancels the animation fallback on pause and only reads actual media time', () => {
    let animation: FrameRequestCallback | undefined;
    const cancel = vi.fn();
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { animation = callback; return 9; }));
    vi.stubGlobal('cancelAnimationFrame', cancel);
    Object.defineProperty(HTMLVideoElement.prototype, 'requestVideoFrameCallback', { configurable: true, value: undefined });
    const videoRef = createRef<HTMLVideoElement>();
    render(<LiveVideoPreview job={fixtureJob()} source="app-media://local/anonymous" videoRef={videoRef} onTimeUpdate={vi.fn()} onError={vi.fn()} />);
    const video = videoRef.current;
    if (!video) throw new Error('Video missing');
    Object.defineProperty(video, 'paused', { configurable: true, value: false });
    fireEvent.play(video);
    video.currentTime = 2.1;
    act(() => { animation?.(0); });
    expect(screen.getByTestId('live-captions').textContent).toBe('Second');
    Object.defineProperty(video, 'paused', { configurable: true, value: true });
    fireEvent.pause(video);
    expect(cancel).toHaveBeenCalledWith(9);
  });

  it('clears prior captions and native cues when a keyed job/source is replaced', () => {
    const job = fixtureJob(); const videoRef = createRef<HTMLVideoElement>();
    const props = { videoRef, onTimeUpdate: vi.fn(), onError: vi.fn() };
    const view = render(<LiveVideoPreview key="first" {...props} job={job} source="app-media://local/first" />);
    if (!videoRef.current) throw new Error('Video missing');
    seek(videoRef.current, .5);
    expect(screen.getByTestId('live-captions').textContent).toContain('Source');
    view.rerender(<LiveVideoPreview key="next" {...props} job={{ ...job, id: 'next', segments: [] }} source="app-media://local/next" />);
    expect(screen.getByTestId('live-captions').textContent).toBe('');
    expect(track.cues).toHaveLength(0);
    expect(disconnected).toHaveBeenCalledOnce();
  });

  it('removes old native cues even when Chromium hides the disabled track cue list', () => {
    const installed: VTTCue[] = [];
    track.addCue = (cue) => { installed.push(cue); };
    track.removeCue = (cue) => { const index = installed.indexOf(cue); if (index >= 0) installed.splice(index, 1); };
    Object.defineProperty(track, 'cues', { get: () => track.mode === 'disabled' ? null : installed });
    const job = fixtureJob(); const videoRef = createRef<HTMLVideoElement>();
    const props = { source: 'app-media://local/anonymous', videoRef, onTimeUpdate: vi.fn(), onError: vi.fn() };
    const view = render(<LiveVideoPreview {...props} job={job} />);
    expect(installed).toHaveLength(2);
    view.rerender(<LiveVideoPreview {...props} job={{ ...job, segments: job.segments.map((cue) => ({ ...cue, translatedText: 'New text' })) }} />);
    expect(installed).toHaveLength(2);
    view.unmount();
    expect(installed).toHaveLength(0);
  });
});
