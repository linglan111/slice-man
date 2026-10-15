# Fix Responses streams after reasoning output

## Request and authorization

The user reports AI subtitle checking still fails and requests a repair. On 2026-10-15 they authorized creating this task/investigating and at most three live requests using the configured service, sending synthetic subtitles only. No video upload, personal project mutation or stored profile change is authorized. This is a narrow bug fix with PRD-only planning; the existing architecture remains unchanged.

After the first three attempts exposed the reasoning content-part lifecycle issue, the user explicitly authorized at most three additional synthetic requests. Round 2 must fail fast after any unsuccessful operation; preserve the original exhausted ledger and a separate additional-allowance ledger. Cumulative authorized maximum is six attempts; no further calls without new consent.

## Observed failure and source

Read-only installed SQLite diagnostics show a failed chapters operation on official DeepSeek, model deepseek-flash, OpenAI Responses mode: HTTP 200, ~128 seconds, ~7 MB/32,662 events, zero normalized answer bytes and STREAM_PROTOCOL. The >30-minute subtitle check invokes chapter planning first, so the failing operation prevents review.

Production StreamProtocol was executed in memory against the official documented sequence: reasoning output_index=0, message output_index=1, output_text.delta at index 1. It reproduces STREAM_PROTOCOL. Code incorrectly applies Chat choice-index zero semantics to Responses output-item indexes. Previous fixtures only emitted Responses text at output_index=0, and live tests were gated/skipped.

Primary contract: https://api-docs.deepseek.com/api/create-response/ and https://api-docs.deepseek.com/guides/responses_api/ (checked 2026-10-15). Reasoning is a separate item preceding the message. Do not save reasoning text.

## Change boundary

- Fix semantic Responses item/content index validation and normal text assembly in src/main/services/providers/lib/stream-protocol.ts. Preserve strict terminal, full-output consistency, tool/refusal/truncation and size protections; malformed indexes must still fail.
- Add unit/HTTP-stream/real Electron regressions for reasoning-first Responses and mixed item/content indexes; verify normalized files omit reasoning and successful operations actually publish.
- Add an explicitly gated real-service native scenario using the current protocol/model: chapter planning, subtitle review and global-name analysis on a tiny synthetic project. Enforce a hard maximum of three upstream requests across the run and persist a sanitized request ledger so a failed rerun cannot silently exceed authorization. No automatic corrective retries may reach upstream after the budget.
- Root coordinates secret access in memory only, readonly against the installed profile; tests use isolated app data and session-only credentials. Never log keys, authorization headers, raw reasoning or personal subtitles; trace/video/automatic failure screenshots disabled for live tests.
- Update the provider contract/spec with this missing real-world event shape. No provider-mode switching, generic timeout increase, production DB migration, UI redesign or chapter workflow redesign.

## Acceptance and verification

1. Official reasoning=0/message=1 streamed sequence succeeds; output index is not treated as a Chat choice index. Valid index-zero Responses remains compatible.
2. Multiple valid parts and completion checks stay consistent. Invalid indexes, wrong final text, incomplete streams, refusal/tools and truncation still reject without publishing partial JSON.
3. AI chapter planning, subtitle check and name analysis work through actual renderer/preload/main/SQLite on reasoning-first local streams. Reasoning never appears in saved answer files or diagnostics previews.
4. Use at most three authorized live synthetic calls. Record actual protocol, HTTP status, sanitized event shape/index counts, operation outcome and diagnostic/publication status; report any provider/validation failure honestly. Native mock coverage cannot be presented as live service success.
5. Appropriate full lint/type/unit and affected native suites pass; independent Trellis check. Deliver a new local verification installer after verified fix, under the user's existing update/commit/package authorization; no push, release or installation into their existing app directory.

## Safeguards

Preserve existing unrelated dirty Trellis scaffolding/spec indexes and seeking-helper line endings. Read-only access to installed app.db must use mode=ro. Do not ask for API keys in chat. Live budget exhaustion or unavailable credentials is reported, never bypassed by resetting the ledger.
