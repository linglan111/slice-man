# Real failure and minimal reproduction

Read-only diagnostic inspection on 2026-10-15. No installed database mutation, API call or credential output occurred during diagnosis.

- Installed database schema is v3 and contains the streamed request record introduced in preview.6.
- Latest request: official DeepSeek, deepseek-flash, OpenAI Responses mode, operation chapters, 1,027 source cues / 3,744,554 ms media.
- HTTP 200; response headers in ~345 ms. Failed after 128,170 ms with STREAM_PROTOCOL, 7,059,049 wire bytes, 32,662 events/heartbeats, zero normalized answer bytes.
- This request was the chapter prerequisite for >30-minute AI checking. No chapter plan or review run was published.
- A read-only in-memory TypeScript transpilation/execution of the production StreamProtocol with the official sequence (reasoning item0, message item1, text delta item1) reproduces STREAM_PROTOCOL. No repository source or personal data was modified by this reproduction.

## Primary source

- https://api-docs.deepseek.com/api/create-response/
- https://api-docs.deepseek.com/guides/responses_api/

Both document reasoning output_index=0 followed by message/text output_index=1. The response.completed terminal carries the complete response and usage; no Chat-style [DONE] event is required.

## Missed verification

Existing unit/HTTP Responses fixtures emitted text at output_index=0. Native provider fixtures streamed Chat only and used whole JSON fallback for Responses; live credentials were gated and those tests skipped. A passing real-Electron test with simulated JSON therefore did not establish reasoning-first provider compatibility. The fix must update the event-shape regression and actually stream real Responses bytes in the newly authorized small native scenario.

## Live authorization boundary

The user explicitly authorized at most three small synthetic requests. Root owns a local ignored credential bridge that opens installed app.db readonly and decrypts the configured key only in Electron memory, then passes it through the child environment. Test app data is isolated and session-only. A durable ledger outside the Playwright output directory prevents budget reset on rerun. No video or personal subtitle content is sent; no key/headers/reasoning is logged.

## First actual live round (3 authorized calls used)

All three operation requests reached official DeepSeek and returned HTTP 200. Each immediately failed STREAM_PROTOCOL at the reasoning item's content-part lifecycle, before normal text. Sanitized ledger: `.native-smoke/responses-fix-20261015/live-ledger.json`.

Observed event order: response.created, response.in_progress, response.output_item.added(reasoning at output0), response.content_part.added(output0/content0), response.reasoning_text.delta. No normalized answer was saved. The first patch's additional content-part validator incorrectly assumed every part belonged to a message; this was a new compatibility error introduced while fixing the original output-index bug. The original pre-fix parser ignored reasoning part events but later rejected text index1.

Implementation and independent review are correcting both assumptions using official reasoning_text content parts. New fixtures contain the reasoning part's full added/done lifecycle as well as message1 text parts. Subsequent live workflow stops after the first failed operation rather than spending the remaining budget on the same transport failure. No more generation requests may be sent without further user authorization; the existing ledger must remain intact.

Two preflight credential-bridge attempts failed before launching the test or making any API request. Windows Electron safeStorage depends on the protected OSCrypt metadata in Local State; copying only that protected metadata into the isolated bridge data directory allowed readonly decryption without initializing or mutating personal app data. No plaintext credential was written to disk.

## Second authorized live round: passed

The user separately authorized at most three additional calls. All three passed through the actual Electron UI and unchanged official Responses SSE: normal chapter planning, subtitle review, and global-name analysis. Each record is HTTP200, streamActual=true, state=published, with complete normalized JSON answer files and persisted business results. The test passed in about 1.1 minutes.

Sanitized evidence is copied under `evidence/live-round1-metadata.json` and `evidence/live-round2-metadata.json`. Round 2 observes reasoning index0 and message index1, both reasoning_text/output_text content-part lifecycles, and a response.completed terminal for each operation. The planner emitted 7,619 reasoning deltas before 56 normal text deltas; it no longer fails when transitioning to text. No reasoning text, credential, prompt or personal subtitle is present in these ledgers.

Actual call accounting: first authorized allowance3 failed attempts + separately authorized additional allowance3 successful attempts =6 total. No further generation was made or is authorized. The second allowance uses a separate durable ledger; the first exhausted ledger was not reset. Only the synthetic two-cue, four-second project was sent, not the user's full 1,027-cue video.
