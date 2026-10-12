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
- Common operation panels use two columns and compact gaps. At native1440×960 and1050×700, ALL active input controls and execute/cancel must be visible and hit-testable without scrolling the panel. A pinned footer alone is insufficient if it covers fields. Deliberately constrained user drag can scroll bounded content while retaining actions.
- Reserve centre-bottom height: title above right proofreading, help/reset in the lower-left sidebar footer, compact horizontal stages to the right of the video-preview title, bounded errors/progress/results below proofreading. All stage labels/states fit the title row even at the minimum dragged preview width; no stage column consumes video width. Footer utilities have accessible labels and remain usable in empty workspaces and collapsed sidebars. Native player/list must retain usable nonzero geometry. Media overlay retains64px controls safety, including synchronous pane shrink before ResizeObserver delivery.
- Video-toolbar order follows creation, correction, styling and export: generate, partial recognition, partial translation (translated projects only), add-overlay subtitle, names, style, export. Every action uses an aria-hidden SVG Icon plus a readable label; icons never replace accessible action names. Native minimum-window forms and footer controls remain hit-testable after icon widths/wrapping change.
- Long save paths use visible abbreviated text with full accessible title; optional encoding details can expand on explicit request. Do not let explanatory text displace required export format/codec/resolution/quality controls beneath the footer.
- Add subtitle immediately follows AI review; follow playback immediately precedes Standards. Standards Modal lives outside independently scrolled cue content and opens from any list offset, with Escape/focus restore.
- Missing/dangling review service opens explicit picker/configuration. Save user's chosen reviewProfileId, then use RETURNED Job revision for review/names. Never select an arbitrary profile or silently reuse translation service.
- Pending contains never-reviewed cues; explicit unchecked is only that subset. Current none is assessed, not missing. Display filters never change main loop risk eligibility or ignored semantics.
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

## 5. Good / Base / Bad Cases
- Good: open export at1050×700, change format/codec/resolution/quality and choose save without scrolling; longer directory stays inspectable through full title.
- Base: open settings from a collapsed sidebar, keyboard-edit, close and return focus to the originating entry.
- Bad: assert only sticky submit visibility while codec fields sit below it, force-click a covered control, duplicate live settings forms, or fake native fit with renderer viewport emulation.

## 6. Tests Required
- `operation-workspace.spec.ts`: seven operations × default/minimum actual BrowserWindow sizes, two columns, every field/action bounds and hit-test, scrollTop0, no calls on open, video/list floor, compact steps and settings focus restoration.
- Standards from list bottom, exact Add/Follow relative placement, missing/dangling review-service saved current revision and unchecked counts.
- Real names/review/native processing workflows, original-only safeguards, manual editing, style/export/path cancel and resizable collapse/reset/keyboard/restart persistence.
- App tests await successful initialization before opening panel; never let initial job-selection effect erase a test's premature interaction and hide it with weakened assertions.
- Open the actual generation panel for empty and populated failed/cancelled jobs; verify retry availability/execution or its intentional absence, not only the default closed panel.
- Full Electron suite after final production build; mock providers establish routing/integrity rather than AI accuracy. Separate external paid/download gates are reported explicitly.

## 7. Wrong vs Correct
Wrong: reserve85px for every inline form, let long export help wrap, and consider visible sticky buttons proof of usable layout.

Correct: measure the active form and reserve its minimum height; compress optional help/path presentation and verify all required fields plus actions in the real minimum native window.
