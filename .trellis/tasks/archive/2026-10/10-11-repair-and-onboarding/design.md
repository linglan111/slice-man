# Combined design

## Boundaries

The repair child owns shared contracts, IPC/preload, main processing, database interruption handling and right-panel operation controls. The guide child owns a renderer component/preference and help integration. App integration is sequenced to avoid simultaneous edits to `App.tsx`; no new dependency is needed.

## Flow

An explicit user click sends revision, threshold and maximum rounds to main. One main lease validates/analyzes, plans a whole round, drafts recognition/retranslation, commits atomically, rechecks dependent content, and repeats until the configured stopping condition. UI renders validated run snapshots and existing Cancel aborts the sole controller. Navigation only explains this flow and has no operation API calls.

The request also carries all/range scope. Requested absolute time bounds remain fixed through the run; current cue IDs are selected afresh per round. Main validates media bounds, and summaries apply to the chosen scope. The user approved complete-cue/recursive-overlap ASR expansion with requested/effective scope display; content outside effective coverage is preserved.

## Compatibility

Optional last-run metadata keeps legacy persisted jobs readable without a relational migration; media options and revision semantics remain stable. Original-only never invokes translation. Exact-grade filtering, manual repair, layout preferences, preview and exports retain their contracts. Navigation is one remembered renderer preference; users upgrading without it see the guide once.

## Risks and trade-offs

ASR may reproduce the same output; maximum rounds are a work bound, not guaranteed convergence. Recursive overlap repair may affect additional cues, including ignored issues; ignore expires when its content/context identity changes. Final analysis failure leaves repaired content and an explicitly stale report. Native Chromium focus and persistence require Electron evidence, not jsdom alone. Tests using deterministic providers establish routing/state correctness, not linguistic or acoustic quality.

## Operational considerations

Use a new `codex/` development branch from the current published baseline. Do not change release workflow/environment or push `release`. No auto-resume on restart. Independent review occurs after implementation and fixes; gate real paid/native tests by actual credentials/runtime and report skips precisely.

## Added scope R9–R11 (approved2026-10-11; implementation and checks in progress)

Review reliability keeps canonical local evidence/dependency groups while sending all selected groups in one compact JSON generation; one optional visible full-selection correction for format/coverage/evidence only. App budgets are 2000 targets / 512 KiB complete UTF-8 prompt, not provider-capacity claims. Strict evidence and atomic report publication remain unchanged. Explicit service setup and unchecked classification address observed first-video/count issues; Standards moves outside the scrolled cue region.

Workspace exposes generation/style/export/name actions in one preview toolbar/active two-column operation panel; lower-left settings entries, right title/status/output allocation and measured sizing reclaim height. Default/minimum native primary/cancel controls must be visible without scrolling. One owner integrates App/SubtitleList so review/name components do not race edits.

Names uses existing review text profile, grounded recurring aliases (>=2 distinct cues), editable recommendations, separate original/active-translation noncascading replacement and one atomic save. Latest successful batch stores bounded field before/after patches for restart undo. Same-field later edits/deleted IDs are retained and reported as conflicts; unrelated edits survive. No multi-level history/redo, automatic application or source-only translation. Detail contracts/limits are in the names child design and research.

Sequence aggregate-review main/contracts first, names main/contracts second; independent operation component work may proceed once approval exists, with sequenced sole-owner App integration. Final independent review/full native suite reruns after all added scope, even though original R1–R8 gates already ran. No commit/publication is implied by feature approval.
