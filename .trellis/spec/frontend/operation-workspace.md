# Visible subtitle operation workspace

## 1. Scope / Trigger
Read when moving subtitle actions/settings, changing measured pane allocation or integrating review/names panels. App owns active operation/dialog and publication callbacks; components own local form drafts. Keep video left and proofreading right, with native-window evidence for layout contracts.

## 2. Signatures and entry points
- Video toolbar: generation, partial recognition, optional partial translation, add overlay cue, person-name check, style and export. `activeOperation` selects generate/style/export/names; partial reprocess/editor states integrate through the same measured panel region.
- Lower-left sidebar: generation/style settings plus existing engine/API/download/export preferences. Settings use existing focus-restoring Modal with one set of form state/handlers.
- `ExportForm` is shared content inside inline export and retained retry dialog; execute preserves actual path selection/options/cancel and main publication. `StyleOperation` is explicit AI action; `StylePanel settingsOnly` exposes configuration.
- `useWorkspaceLayout` owns persisted width/height and keyboard/drag clamping; include actual preview-media and active operation in allocation, not the old fixed tiny form floor.

## 3. Contracts
- Opening a toolbar panel is navigation, never recognition/AI/export execution. Show one active panel; preserve unrelated drafts while another panel is active. Explicit execute/cancel and source-only availability remain.
- Operation panels group related content responsively; two columns are not mandatory. Each is a separate natural-content-height bottom-aligned card, with no height resize handle or filler below its final action. Remaining left-column height belongs to preview. At native1920×1080,1440×960 and1050×700, all required initial fields/actions are visible and hit-testable without scrolling. Long candidate/context/error content is bounded locally while required actions remain reachable.
- Preview is one left-side card with project metadata above the centered enlarged workflow stages, video and toolbar. A separate operation card follows it. Narrow panes adapt stage icons/labels without overlap; sidebar settings remain the only settings entry. Collapse/help/reset form an accessible SVG utility cluster below the brand in the upper left, vertical when collapsed; the lower-left footer contains settings only. Right-side errors/messages/progress/stages/outputs share one results card below proofreading; one horizontal pointer/keyboard divider adjusts that split, persists results ratio and supports cancel/reset/restart. Ignore obsolete editor/secondary values while retaining valid sidebar/column dimensions. Top-layer dialogs never contribute to measured proofreading chrome or move cue scroll positions. Keep the cue-list75px floor and media-control64px safety.
- Video-toolbar order follows creation, correction, styling and export: generate, partial recognition, partial translation (translated projects only), add-overlay subtitle, names, style, export. Every action uses an aria-hidden SVG Icon plus a readable label; icons never replace accessible action names. Native minimum-window forms and footer controls remain hit-testable after icon widths/wrapping change.
- Long save paths use visible abbreviated text with full accessible title; optional encoding details can expand on explicit request. Do not let explanatory text displace required export format/codec/resolution/quality controls beneath the footer.
- Heading actions: icon-labelled 字幕自动修复, AI review, Add. Multi-filter trigger and 可疑度标准 are on the left; 全选/取消全选, 选择时间范围 and Follow are on the right. Filters union grades/statuses in timeline order, deduplicate, and treat all as exclusive (empty choice restores all). Select-all merges current visible IDs; cancel removes only visible IDs, preserving other selections. Time selection validates an explicit half-open interval and merges cues matching both the current filters and startMs < end / endMs > start. Selection/filtering never invokes AI or changes processing eligibility. Standards has one Modal title/close; repair/time/standards dialogs are mutually exclusive and outside cue scrolling, with Escape/focus restoration. Repair drafts survive same-job close/reopen, execution uses the current revision, and close never cancels work.
- Missing/dangling review service opens explicit picker/configuration. Save user's chosen reviewProfileId, then use RETURNED Job revision for review/names. Never select an arbitrary profile or silently reuse translation service.
- The single primary AI review button opens the scope modal; do not add a second scope button or start a model request before confirmation. All/selected/time-range choices use the existing guarded review API; row-level recheck and chapter-resume shortcuts keep their precise existing targets.
- Recoverable in-session AI failures retain an explicit retry action with original range/selection/input and captured project/revision/options/profile identity. Retry executes only on user click and matching identity, never automatically; changed identity requires settings confirmation. Custom chapter criteria without a captured stable revision require setup again. Historical failed/interrupted diagnostic records reopen the matching form and never guess missing targets or prompt/options; published/cancelled/foreign/no-job records offer no replay. Repeated failure preserves prior content; successful retry clears stale panel errors.
- Expose one unchecked filter covering unreviewed, legacy and stale assessments; do not expose a duplicate pending filter. Current graded findings remain in their effective grade, including ignored findings; internal pending repair IDs retain their separate lifecycle meaning. Current none is assessed, not missing. Display filters never change main loop risk eligibility or ignored semantics.
- Names progress matches current job and clears on new run/job change; cancelled analysis preserves previous results. Names reports/inputs/undo use dedicated PersonNamePanel and typed callbacks; actual AI/apply needs explicit user action.
- Generic retry is offered only for an empty timeline. Existing cues use explicit translate-all or confirmed recognize-original and export actions; never render an enabled retry that silently returns without work, or silently replace corrected source to retry translation.
- Storage failure cannot crash startup, layout drag/reset or collapse. Existing guide startup/dialog priority remains; final guide labels reflect lower-left settings and video-toolbar export.

## 4. Validation & Error Matrix
| Situation | Required behavior |
| --- | --- |
| Open an operation | Zero provider/processing calls until execute |
| Minimum native window or long save path | Fields AND actions visible/hit-testable, no panel scrollTo needed |
| User deliberately shrinks panel | Bounded content scrolling, retained action access, no shell horizontal overflow |
| Missing/deleted review profile | Actionable explicit service picker; current revision used after save |
| Standards opened from list bottom | Independent visible Modal, keyboard dismissal/focus restoration |
| Source-only project | No translated editor/action/provider call or stored-translation display |
| Job switch/late names event | No old-job operation progress in current workspace |
| Export/native path cancelled or processing failed | Existing file/timeline preserved; explicit recoverable result |
| Failed translation with existing cues | No inert generic retry; explicit translate-all works without ASR or source replacement |
| Same-session failed scoped review / chapter / names / style / translation | Explicit original-operation retry when identity matches; no hidden recognition or all-scope fallback |
| Historical/changed/custom-criterion retry | Reopen the corresponding form for explicit confirmation; no immediate provider call |
| Startup error without a project | No inert retry action based on two undefined IDs |

## 5. Good / Base / Bad Cases
- Good: open export at1050×700, change format/codec/resolution/quality and choose save without scrolling; longer directory stays inspectable through full title.
- Base: open settings from a collapsed sidebar, keyboard-edit, close and return focus to the originating entry.
- Bad: assert only sticky submit visibility while codec fields sit below it, force-click a covered control, duplicate live settings forms, or fake native fit with renderer viewport emulation.

## 6. Tests Required
- `operation-workspace.spec.ts`: open and visually inspect all seven panels at native large/default/minimum sizes; check every required field/action bounds/hit-test, natural bottom-card height/no filler/no height handle, responsive grouping, video/list floor, widened stages, settings focus, multi-filter/select-all and validated time selection with zero provider calls.
- Standards from list bottom, exact Add/Follow relative placement, missing/dangling review-service saved current revision and unchecked counts.
- Real names/review/native processing workflows, original-only safeguards, manual editing, style/export/path cancel and resizable collapse/reset/keyboard/restart persistence.
- App tests await successful initialization before opening panel; never let initial job-selection effect erase a test's premature interaction and hide it with weakened assertions.
- Open the actual generation panel for empty and populated failed/cancelled jobs; verify retry availability/execution or its intentional absence, not only the default closed panel.
- Full Electron suite after final production build; mock providers establish routing/integrity rather than AI accuracy. Separate external paid/download gates are reported explicitly.

## 7. Wrong vs Correct
Wrong: reserve85px for every inline form, let long export help wrap, and consider visible sticky buttons proof of usable layout.

Correct: measure the active form and reserve its minimum height; compress optional help/path presentation and verify all required fields plus actions in the real minimum native window.
