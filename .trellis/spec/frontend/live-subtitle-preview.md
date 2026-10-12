# Live Subtitle Playback

## 1. Scope / Trigger

Read when changing the video player, playback clock, live caption selection, inline timeline editing or lyrics following. The renderer uses the current persisted job timeline. Live feedback is responsive browser rendering; exact final appearance is established by ASS/libass output. Manual reference-image UI is removed; its backend API remains for internal tests.

For the surrounding action panels and measured video/form allocation, also read [operation-workspace.md](./operation-workspace.md). Retain the native controls safety region while resizing either module.

## 2. Signatures

```typescript
LiveVideoPreview({
  job: Job,
  source: string,
  videoRef: RefObject<HTMLVideoElement | null>,
  onTimeUpdate: (timeMs: number) => void,
  onError: () => void,
  isBusy?: boolean,
  onEdit?: (segment: Segment) => void,
  onActiveChange?: (ids: string[]) => void,
}): ReactNode;

useVideoClock(videoRef, source): {
  timeMs: number;
  isSeeking: boolean;
  hasFrame: boolean;
  rect: { left: number; top: number; width: number; height: number };
};

captionLines(segment: Segment, bilingual: boolean, translationEnabled?: boolean): CaptionLine[];
activeCaptions(segments: readonly Segment[], timeMs: number): Segment[];
containedVideoRect(width, height, videoWidth, videoHeight): VideoRect;
emphasizedParts(text: string, keywords: readonly string[]): TextPart[];
captionOpacity(segment, timeMs, animation): number;
nativeCaptionText(segment: Segment, bilingual: boolean, translationEnabled?: boolean): string;

SegmentEditor({ segment, durationMs, onSave, onClose, onDelete?, isBusy?, isNew?, translationEnabled? }): ReactNode;
SubtitleList({ job, selectedIds, activeIds, isBusy, isEditing, editingId?, draftStartMs?,
  editor, onAdd, onRemove, onSelect, onEdit, onSeek, onRetranslate,
  onReview?, onRepair?, onIgnore?, onPlay?, onRepairRange? }): ReactNode;

SecondaryControls({ initiallyExpanded, children }): ReactNode;
PaneDivider({ label, orientation, value, minimum, maximum, onChange, cancel,
  className?, position? }): ReactNode;
```

Sources: `components/LiveVideoPreview.tsx`, `hooks/useVideoClock.ts` and `lib/live-captions.ts` under `src/renderer/src/`. No additional IPC, provider request, recognition or video encoding is needed for live captions.

## 3. Contracts (Request / Response / Environment)

- Display a cue exactly when `startMs <= timeMs && timeMs < endMs`. Include overlapping active cues; gaps have no caption. Invalid negative/nonfinite clock values select nothing.
- Pass the Job's `translationEnabled` to windowed and native subtitle helpers. When disabled, use source text even if an older translation remains stored. When enabled, use `translatedText || sourceText`, adding source beneath a nonempty translation only when bilingual is enabled. No translation prerequisite is allowed for source-only playback.
- Drive the focused player clock from actual presented frames/media events during playback. After a paused seek, use settled `video.currentTime`; a presented-frame timestamp can be one frame earlier and must not erase a cue exactly at its start. Workspace time labels remain coarse. Do not use a requested seek target alone as proof of a settled media position.
- Hide obsolete captions while seeking or without a playable frame. Refresh on paused seeks, playback, metadata/resize and media errors. Cancel frame/animation callbacks, remove listeners and disconnect observers on cleanup.
- Key/reset the player for job/source changes; text/timing/translation/style updates must immediately use the current job without reconstructing or modifying its timeline.
- A windowed visible caption is a per-cue accessible edit target. Pause playback before showing its inline form, capture the originating job/source/revision, and use the shared edit/add/remove methods. Proofreading edits appear inside the corresponding row; preview edits appear next to the player. Do not open a subtitle-edit modal or persist drafts before save. Cancel/failure/stale completion retains valid content; delayed completions must not clear a newer editor.
- Both locations support manual addition/deletion, including gaps and empty/all-cue states. Derive initial new-cue timing from actual video.currentTime, bound it to media duration, and require user content. Never repeat ASR/translation for manual CRUD. A usable manually supplied timeline can translate without an installed speech engine; invalidated retained recognition must show an actionable hint instead of secretly rerunning ASR.
- Compute the `object-fit: contain` content rectangle from decoded video dimensions and fractional displayed element bounds (`getBoundingClientRect`), rather than integer-rounded client sizes. Apply relative style positions/font sizes inside that rectangle, including portrait letterboxing. Only actual edit targets receive pointer events; blank overlay areas and video controls remain usable.
- Bottom-anchored windowed captions keep a native-control clearance floor of 64px in addition to the configured relative margin. Clamp the overlay's maximum width/height to its current player bounds in CSS so an asynchronous ResizeObserver rectangle cannot extend edit targets into controls during pane shrinkage. Verify overlapping bilingual clickable caption boxes and actual native timeline clicks; do not place edit buttons over the control row. This browser feedback clearance does not change ASS burn-in layout.
- Render inline text through React text nodes. Match emphasis as literal keywords, never arbitrary regex or HTML. Escape WebVTT metacharacters for native `VTTCue` text.
- CSS follows bounded color, typography weight, relative size/position/width, shadow, emphasis and fade configuration. Browser wrapping/font rasterization is approximate. Use a system CJK fallback when the managed export font is unavailable in the browser; never silently claim identical font output.
- Native video fullscreen excludes sibling CSS. Reuse a synchronized native subtitle track for that mode, retain current text/bilingual content, and avoid duplicate native plus CSS captions. Native fullscreen typography is browser-controlled. Retain the actual installed `VTTCue` references for cleanup: a disabled track's `cues` can be null, so reading that property alone does not remove old cues. Do not accumulate tracks/cues on each revision.
- All desktop tests use isolated user data and anonymous media. The user's running application, original files and job database must not be reused as test fixtures.
- Proofreading highlights all actual `[start,end)` cues like lyrics and follows them inside its own scroll container. Gaps/seeks/job changes update highlighting. Following is user-controllable and paused during editing/manual browsing; do not scroll the document or rerender the entire App every video frame.
- At minimum native window size, error/status banners and long inline forms must keep the player, action bar and proofreading viewport visible. Preview forms and processing panels scroll locally with a usable viewport; do not reduce them to a footer-only strip to satisfy document bounds. Verify the editor viewport as well as the player/list geometry in actual Electron.
- Retry keeps the failed operation's scope. With retained cues, retry partial processing through its existing target panel or use an explicitly named full operation; never route a generic retry to full translation or report generation success when no work ran. The generic unfinished-stage action is limited to initial empty-timeline generation and failed export.
- The workspace fits the actual renderer viewport (native window chrome reduces its height). Video, creation/processing controls and proofreading remain visible at 1440x960 and 1050x700 with expanded/collapsed navigation, portrait video, banners and long inline forms. Settings, proofreading and inline forms own local scrolling. Check usable inner viewport sizes, not only clipped outer bounding boxes; an editor reduced to one footer line is not usable.
- Proofreading stays on the right with fixed common controls and independently scrolling cues. Preview stays on the left, with generation/style/output content beneath it in an accessible disclosure. Initially expose secondary controls for empty timelines and collapse them for saved cues unless an explicit `slice-man.secondary-expanded` preference exists. Preserve the initial choice through generation/progress and retain mounted style drafts during collapse.
- Expanded navigation width, preview/proofreading width, preview/expanded-secondary height and preview/visible-form height have pointer/keyboard separators. `slice-man.layout` stores `{ sidebar: number | null, columns: number, secondary: number, editor: number }`; malformed or nonfinite values recover to defaults. Ratios represent flexible allocations, while sidebar pixels are bounded. Reset clears dimension preferences independently of collapse/disclosure state. Measure actual bounds even without a project; passive window/state reclamping never rewrites saved proportions.
- Divider pointer capture commits only on release; Escape, pointer cancellation, lost capture and unmount restore the pre-drag allocation and clear cursor/selection state. Arrow keys adjust along the divider axis, Shift changes the step and Home/End select bounds. Hidden/collapsed regions have no active resize handle. Compute active floors from actual CSS, and remeasure when error/reload elements are inserted, not only when existing boxes change size.
- Preview editing and scoped processing share one visible form area. Opening scoped repair keeps an existing preview subtitle editor mounted but hidden, restoring the exact unsaved draft when repair closes; preview add/edit returns to editor mode. A list editor may remain visible alongside left-side repair. Never budget one form while showing two minimum-height forms. Sticky save/cancel controls do not replace a usable input viewport.
- Retry must preserve its operation and scope. A failed/cancelled partial operation retains its panel target for explicit resubmission. Do not route generic generation retry over retained subtitles: that can become a no-op in original-only mode or an unintended full translation in translated mode. Existing subtitles have explicit partial, full recognition and full translation actions.

## 4. Validation & Error Matrix

| Event | Required behavior |
| --- | --- |
| Recognition complete; translation empty | Source captions immediately usable |
| Translation/bilingual changes | Current cue switches to matching target/source content |
| Exact cue end / gap | Previous cue removed |
| Overlapping cues | All active cues available |
| Pause / backward or forward seek | Correct caption at actual settled time |
| Job/source switch / media empty/error | No stale captions from the previous frame/job |
| Text resembles HTML/ASS or keyword contains regex punctuation | Literal safe text, no execution or regex semantics |
| Portrait/resize | Captions stay inside actual video content bounds |
| Native fullscreen enter/exit | One caption path, synchronized text; no stale cue buildup |
| Cue click / inline row editing | Pause, correct cue/job/revision, no modal, safe save/cancel |
| Manual add/remove / delayed save after switch | Shared guarded CRUD; no native/provider request or wrong editor closure |
| Lyrics follow during typing/manual browse | Highlight remains correct; do not scroll input away; user can resume |
| Extreme pane drag / native viewport shrink | Clip-aware limits preserve video, list and actual action hit targets |
| Preview draft -> repair -> close | One visible form; exact unsaved subtitle draft returns |
| Late playback error at minimum preview | Remeasure inserted error/reload controls; retry remains clickable |
| Empty welcome sidebar drag / reset | Actual window measurement and reset work without a Job |

## 5. Good / Base / Bad Cases

- Good: a recognized Japanese cue displays while playing, then immediately shows a corrected Chinese translation at the same time without an AI call.
- Base: source-only playback with ordinary bottom captions, pause and subtitle-button seeking.
- Bad: require a rendered still image before any live caption appears; show a previous video's text; claim CSS/browser fullscreen is identical to burned-in ASS.

## 6. Tests Required

- Unit: source/translation/bilingual selection, `[start,end)` boundaries, gaps/overlaps, literal keywords/markup, fade bounds and portrait/landscape containment.
- Component/clock: playing/paused/seeking transitions, callback/listener cleanup, stale source and failed-media state, edited content/timing and track reuse.
- Actual isolated Electron: visible source-only captions, translated/bilingual changes, editing, playback/paused forward-backward seeks and subtitle-time buttons at actual video times. Inspect inline/native fullscreen behavior and decoded video geometry where supported.
- Actual isolated Electron for every follow-up: removed reference UI; preview/list inline time/text edit, add/delete, no modal, busy/stale/invalid/cancel behavior, exact corrected exports, lyric active/gap/overlap/seek highlighting and follow/manual browse/edit safeguards.
- Actual minimum/default native window layout with banners, portrait media and long forms; assert inner editor/list usability and no document scrolling, then visually inspect saved screenshots.
- Actual 1050x700, 1440x960 and 1920x1080 pane resizing with pointer/keyboard/extreme limits, both disclosure/sidebar states, restart/reset, draft-to-repair restoration, late playback errors and no-project navigation. Assert preview controls/help/errors against their clipping ancestor plus click hit targets, not only against document bounds.
- Preserve the long unbuffered seek, explicit re-recognition, reference rendering and export suites. Mock provider evidence is separate from native inference/linguistic accuracy.

## 7. Wrong vs Correct

Wrong: show subtitles from an optimistic workspace timestamp and re-render the entire App at every frame.

Correct: keep the media clock inside the focused player, derive current captions from actual media state and retain the exact reference renderer for final appearance checks.
