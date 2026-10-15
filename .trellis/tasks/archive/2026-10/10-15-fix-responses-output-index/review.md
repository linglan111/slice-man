# Independent review — Responses reasoning-first repair

Reviewed on 2026-10-15 (Asia/Hong_Kong). The reviewer made no generation requests, accessed no installed personal database and changed no production code. Findings were resolved by the assigned implementers before this final review.

## Findings resolved

- The original parser treated Responses `output_index` like a Chat choice index and rejected the valid assistant message at index 1 after reasoning at index 0. The shared parser now tracks output-item identity and normal text by item/content indexes.
- The first repair introduced a second compatibility error: its content-part validation assumed every part belonged to a message. Official DeepSeek reasoning items also have `reasoning_text` content and content-part added/done events. The corrected dispatch classifies the part before binding its item kind. Reasoning is a heartbeat only and does not contribute to the normalized answer map or file.
- Final item/part content consistency, normal termination, invalid indexes, incompatible identities, late text, refusal, tools and truncation remain covered. Existing index-zero Responses and other provider protocol tests pass.
- The native fixture now includes the actual reasoning content-part lifecycle, message index 1, multiple output-text parts, split SSE bytes, SQLite publication and restart. Its earlier incomplete shape was insufficient and is not presented as prior proof of real-provider compatibility.
- The live harness preserves upstream SSE bytes and Content-Type. A durable reservation is fsynced before each upstream call; an exclusive fail-closed ledger lock prevents concurrent budget reuse. Cleanup is nested, credentials are session-only, and live trace/video/screenshots are disabled. The workflow now stops after the first unsuccessful operation.

## Actual live evidence and authorization accounting

Both ledgers were read independently. They contain event names, index/type counts, protocol/model, HTTP status and application publication state, without answer text, reasoning, prompts or authorization headers.

1. `.native-smoke/responses-fix-20261015/live-ledger.json`: the first authorized three calls (chapters, review, names) each returned HTTP 200 but failed `STREAM_PROTOCOL` at the reasoning content-part lifecycle, before normal answer bytes. All three remain recorded as failures. They exposed the newly introduced message-only part assumption.
2. After the user's additional authorization, `.native-smoke/responses-fix-20261015/live-ledger-round2.json`: exactly three additional calls, using the configured official DeepSeek service, `deepseek-flash`, OpenAI Responses and streaming. All three reached `response.completed`, HTTP 200 and application state `published`. Normalized answer sizes were 202 bytes (chapters), 105 bytes (review) and 314 bytes (names). Metadata records reasoning item/index 0, normal message/index 1, and both `reasoning_text` and `output_text` content-part lifecycles.
3. `live-test-round2.log` records the separately gated native test passing. The executed test clicks all three operations through Electron, asserts current chapter/review/name results, and checks complete normalized answer artifacts and diagnostic publication.

Total actual generation requests: six, under two separate authorizations of at most three each. Neither exhausted ledger was reset. No further request is authorized by this review.

## Verification

- Reviewer reran full lint and TypeScript checks after the final parser correction: both passed.
- Reviewer independently reran the four provider/stream/diagnostic suites: 89/89 passed.
- Root full unit/integration log `.native-smoke/responses-fix-all-unit-final.log`: 77 files, 771 tests passed.
- Root full native Electron log `.native-smoke/responses-fix-full-e2e.log`: 42 passed, 4 skipped, no failures. This includes the updated reasoning-first native scenario, long-review resume, operation layouts, actual CPU/CUDA inference and media export tests.
- The four full-suite skips are the authorized real YouTube/Bilibili scenario, the two older gated DeepSeek live scenarios, and the new gated Responses live scenario. The last was run separately and passed in round 2; the other three were not newly verified live by this task. Do not describe all four as subsequently executed.

## Limits and remaining findings

No remaining material code finding was identified after the correction. Real-service verification used only a tiny synthetic subtitle project; it did not upload video, rerun the user's 1,027-cue project, establish translation/style quality on the live provider, or prove all other providers' live compatibility. Broader local native regressions use HTTP fixtures where noted. Packaging and installer verification are separate root-owned steps and are not certified by this review before they run.

Primary contracts independently consulted: [DeepSeek Responses API](https://api-docs.deepseek.com/api/create-response/) and [Responses streaming guide](https://api-docs.deepseek.com/guides/responses_api/). They explicitly distinguish reasoning/message content types and define content-part lifecycle events for output items.
