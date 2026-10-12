# Operation workspace design

Status: approved2026-10-11; implementation in progress. Research: parent `research/operation-workspace.md`.

## Layout and responsibilities
Keep preview left and proofreading right with draggable persisted width/height, collapse and reset. Preview toolbar exposes generation, re-recognize passage, retranslate passage, add overlay subtitle, style, export and person-name review. One `activeOperation` displays the selected compact two-column panel below the toolbar. Opening a panel is navigation; explicit execute starts work.

Move generation and style configuration entries to lower-left settings access. Reuse/extract JobSettings/StylePanel form sections rather than duplicate active inputs. Settings open accessible two-column dialogs. Preserve existing engine/API/download/export-default settings and source-only visibility. Generation/style operation panels show the current setup, prerequisites and explicit actions/settings access. Reuse partial-reprocessing scope/effective-range validation and SegmentEditor. Export form extraction preserves path selection, progress/cancel and option persistence.

Reclaim height by placing workspace title/help/reset above right proofreading; compact workflow stages beside preview; bounded errors/results/export entries below proofreading. Keep the cue list nonzero, long messages/paths bounded and active-job cancellation visible. Empty workspace keeps consistent guide access. Add subtitle immediately follows AI review; follow playback immediately precedes Standards. Standards modal/service picker behavior belongs to review reliability but integrates through this sole App/SubtitleList owner.

## Sizing and accessibility
Shared panel grid has compact gaps and a visible action footer; avoid nesting a second vertically scrolling form. Include active panel and actual measured content in useWorkspaceLayout allocation, preserving video safety area and sensible minimum dimensions. At default1440x960 and minimum1050x700, each opened operation's execute/cancel is within the visible panel without scrollTo, while preview and proofreading remain usable. At deliberately constrained user drag sizes, bound content scrolling and pin actions rather than cause horizontal overflow.

Use semantic controls, existing Modal/focus restoration and current keyboard splitter behavior. Update guide labels after final integration. Do not change processing IPC, provider selection semantics or operation locks in this child.

## Validation and rollback
Native Electron geometry for every toolbar panel/settings dialog, sidebar collapse, long errors/results, scroll-bottom standards, relative button placement, drag/reset/restart. Retain manual CRUD, clicked subtitles/native media controls, recognition/translation/style/export and loop/name workflows. Extracted forms keep a single publication handler; rollback layout coherently with hook measurements, CSS and selectors. Do not relax functional safety assertions to accommodate new spacing.
