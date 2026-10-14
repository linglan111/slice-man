# Planning decision ledger

## User decisions on2026-10-13
- Stream AI text responses into local files during reception, and add related request logs to SQLite.
- Content-chapter translation becomes the default.
- For video duration>1_800_000ms, subtitle checking runs by chapter; videos exactly30 minutes or shorter retain aggregate selected-set checking.
- Rename the optional highlight selection mode to`自定义切分章节`. Keep managed criteria, now phrased generally so selection is not limited to highlights.

## Preserved requirements
- Chapters are content based and no longer than1_200_000ms. Time cap and model input/output capacity are separate controls.
- Name analysis requires full-timeline identity context; partitioning names would lose the cross-chapter variant evidence requested previously. User authorized chapter checking for subtitles, not a change to name identity semantics.
- Streamed partial JSON must survive failure in files but cannot count as validated complete output or modify subtitle content/review grades.
- Keep explicit user cancel, no hidden repeat of expensive partially emitted generations, all-target/canonical evidence checks, source-only safeguards and conflict-preserving name undo.

## Technical proposals for final plan
- A SQLite migration stores request/run/operation identities, job/profile/model/protocol references, start/header/first/last/end timestamps, input/output bytes, target counts, HTTP status, terminal/error state, optional provider usage and owned response file reference. Store no API keys, authentication headers or whole prompts in logs. Pace updates; finalize once and mark active requests interrupted on restart without automatic paid replay.
- Stream adapters distinguish connection/header timeout, idle output timeout and a bounded overall deadline. Heartbeat/data activity keeps idle timing alive; receiving reasoning progress may count as activity, but private chain-of-thought is not persisted as subtitle output. Validate protocol completion/truncation before applying JSON.
- Reuse normal coverage chapters for translation and long-video review. Sparse custom chapters are independently selectable/exportable and never define whole-video translation coverage.
- Review assigns each selected cue to one chapter request while maintaining original whole-timeline canonical evidence groups, including neighbours across chapter boundaries.

## Blocking decision
Resolved by user reply`保留`: publish validated chapter review results incrementally, preserve completed chapters on later failure/cancel, and explicitly resume only remaining chapters. Invalid or partial streamed output is not a completed chapter. Show incomplete coverage honestly and keep unprocessed cues unchecked or stale as appropriate.

Other proposed defaults (plan editing, one active criterion, safe filename collisions and completed-export retention) are part of the final reviewable plan. They are not implemented or treated as independently approved before that review.
