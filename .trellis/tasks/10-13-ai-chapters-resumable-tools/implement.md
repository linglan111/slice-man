# Implementation and verification plan

## Planning/start gate
Final PRD convergence completed; all user decisions recorded. Keep every task planning until the user explicitly approves the latest final summary in a subsequent message. Curated implement/check contexts must validate. No product code, migrations against installed DB, live provider calls or automatic installs before approval.

## Child dependencies and sequence
- A `.trellis/tasks/10-13-ai-streaming-diagnostics`: independent provider/diagnostics foundation.
- B `.trellis/tasks/10-13-chapter-translation-review`: depends on A's typed streaming/diagnostics observer; owns shared normal/custom chapter contracts and reusable planner.
- C `.trellis/tasks/10-13-resumable-managed-tools`: independent of A/B/D; may implement in parallel in disjoint artifact/runtime/tool files.
- D `.trellis/tasks/10-13-custom-chapter-export`: depends on A and B's validated chapter contract/planner; owns custom criteria/export and integrated chapter UI. Coordinate App/IPC/shared schema edits through parent.
- Parent integrates compatibility/spec/docs, delegates independent cross-layer review and actual native regression. Dependencies are repeated in each child artifact.

## Work checklist
1. Snapshot foreign dirty files and current branch; never revert or commit unrelated edits. Read relevant specs and research via curated contexts.
2. Establish shared versioned contracts/observer/module ownership; additive SQLite migration/legacy fixtures and safe diagnostics repository.
3. Implement A: protocol adapters, bounded file sink, header/idle/overall deadlines, no hidden costly timeout replay, paced SQLite status/usage, restart interruption, compatibility controls and diagnostics UI contract. Run provider/request/storage fixtures.
4. Implement C: durable pinned artifact cache, validated range transport, installer staging isolation/activation guards, free space/status/clear; cover every managed asset and graceful/forced restart with actual retained/transferred bytes.
5. Implement B: full-source normal planner/cap/freshness, default translation chapter/work-unit coordinator, selected chapter review gate/global evidence, incremental report/run coverage+remaining resume, names-global and repair prerequisites. Preserve existing partial/combined atomicity and full completed-work retention.
6. Implement D: SQLite standard library/selection/version snapshots, custom planner UI, plan editing/seek/selection, safe title allocation and selected media/subtitle range export with real A/V/ASS/SRT/VTT tests. Expose all required controls in content-sized panel at native minimum.
7. Integrate typed main/preload/result/error/progress paths, profile mutation guards and original-only cases; align specs and README/English usage/onboarding. Update superseded tests/specs explicitly instead of weakening integrity assertions.
8. Run global lint/typecheck/full unit/integration, production build, then native affected and full Electron suite sequentially where singleton/media fixture conflicts exist. Delegate a reviewer to audit actual screenshots and operation functionality; fix material findings and recheck only affected paths.
9. Once implementation is verified, scoped local commit under prior user delivery authorization; build next verification installer using extraMetadata.version without changing formal release branch. Run packaged real SQLite/IPC/resources/startup checks, checksum and validation report. No push/release/install into user's existing app directory.

## Commands and evidence
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.
- New/affected Playwright suites plus `npx playwright test` with explicit ignored `.native-smoke` output. Three native sizes1050x700/1440x960/1920x1080 and actual all-action panels/criteria/dialogs/diagnostics screenshots.
- Actual fixture HTTP server records SSE/request count/transferred range bytes; actual SQLite migrations/restart, pinned artifact hashes/probes and FFmpeg decode/probe validate exported clips. Distinguish clear idle/cancel/failure/complete states.
- `npm run make -- --config.directories.output=dist/<verification-output> --config.extraMetadata.version=<next-preview>`; `npm run test:package -- --app-dir dist/<verification-output>/win-unpacked`.
- Validation metadata includes exact commit, test totals, any initial failures/rechecks/skips, protocol/real-model limitations and installer SHA256.

## Risk and rollback checkpoints
- Provider adapter/log migration lands before changing default workflows; keep legacy JSON compatibility and installed DB fixture tests. Migration is additive; never downgrade user_version or delete jobs.
- Partial review merges must preserve canonical group identity and scoped ignore intent; streaming partial JSON cannot become a result.
- Work concurrency must not save stale revisions or release operation lease while requests survive; repaired/scoped changes remain atomic.
- Range/download cleanup must touch only validated cache/staging entries and preserve installed pointers/user files; durable copies need free-space tests.
- Range media export must prove audio offsets and subtitle rebasing using actual bundled FFmpeg; filenames never authorize path traversal or overwrite.
- No unrequested streaming chain-of-thought publication, cloud/API secret logging, paid tests or external publishing.
