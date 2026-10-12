# Research: Single-request selected-subtitle review

- Query: Inspect every selected subtitle (all subtitles when none are selected) in one JSON generation, retain canonical rubric/evidence and dependency staleness, and recover safely from malformed contextual evidence.
- Scope: internal; planning only for the review-reliability addition; no personal subtitle text, credentials or databases read.
- Date: 2026-10-11

## Findings

### Files found

| Path | Responsibility |
| --- | --- |
| `src/main/services/jobs/lib/job-service.ts` | Public review operation lease and private `reviewDraft` reused by automatic repair; report publication and partial-report merge. |
| `src/main/services/jobs/lib/reprocessing.ts` | Canonical windows, cue/context fingerprints, context invalidation and strict internal assessments validation. |
| `src/main/services/providers/lib/text-provider.ts` | Provider-neutral generation, JSON parsing, transport retries and truncation handling. |
| `src/shared/reprocessing-contracts.ts` | Persistent review report/assessment/context-group schemas and review IPC input. |
| `src/shared/review-rubric.ts` | Closed rules and fixed category/risk/evidence semantics. |
| `src/renderer/src/App.tsx` | Review invocation, profile state/setup orchestration and review progress display. |
| `src/renderer/src/components/SubtitleList.tsx` | Review action availability, filters and standards entry. |
| `src/renderer/src/components/ReviewRubricHelp.tsx` | Existing standards explanation content. |
| `src/renderer/src/lib/review-presentation.ts` | Current/none/unreviewed/stale classification and filter counts. |
| `tests/unit/backend/review-assessments.test.ts` | Canonical validation/context dependency regressions. |
| `tests/unit/backend/providers.test.ts` | Provider protocol, finish reason, limits and timeout regressions. |
| `tests/integration/backend/reprocessing.test.ts` | JobService review/report preservation and partial reprocessing; provider prompt fixture parsers require adaptation. |
| `tests/e2e/helpers.ts` | Native HTTP mock parses current per-window prompt and returns UUID assessments; must learn aggregate wire contract. |
| `tests/e2e/contextual-review.spec.ts` | Strict contextual/evidence, full versus selected and native persistence/layout regressions. |
| `tests/e2e/repair-loop.spec.ts` | Automatic-repair reassessment shares changed review primitive. |
| `tests/unit/frontend/SubtitleReviewGrades.test.tsx`, `AppSubtitleWorkflow.test.tsx`, `AppRepairLoop.test.tsx` | Grade counts/actions and reviewer/repair integration. |

### Why current review is slow and why the evidence error is meaningful

- `job-service.ts:1027` `reviewDraft` builds canonical windows, then `job-service.ts:1063` iterates them and awaits one `generateText` per nonempty target window. A 1,027-cue timeline needs at least 35 sequential generations under the 30-target ceiling; 24k serialized-character limits can increase that count. Repeating the rubric and UUIDs adds input/output overhead. Response is already JSON; changing its formatting alone does not remove serial calls.
- `reprocessing.ts:189` canonical windows partition the *full* sorted timeline, not the selected set, into up to 30 core cues plus up to two neighbours on each side under a separate 8k-character context budget. `reprocessing.ts:242` hashes rubric version, mode, core IDs, supplied-context IDs and fingerprints.
- `reprocessing.ts:265` validates every graded target exactly once, derives risk/category from fixed rules and rejects unknown IDs, unsupported translation rules, duplicate rules/evidence and insufficient coverage. `reprocessing.ts:331` checks chronological proximity within two positions of the supplied contiguous context. Context inconsistency/omission require target plus >=1 neighbour; sustained breakdown requires target plus >=2 neighbours. `REVIEW_EVIDENCE` is a valid rejection of a model claim without required evidence, not a reason to weaken validation.
- `text-provider.ts:27` transport retries transient HTTP/network failure up to three attempts independently of model-output correction. `text-provider.ts:80` generation currently fixes Anthropic `max_tokens` at 8,192; OpenAI requests have no explicit output-token cap; Gemini JSON MIME type and optional OpenAI JSON-object mode constrain format, not semantic coverage. Existing finish reasons detect truncation before report publication.

### Recommended aggregate input and compact wire output

One logical initial generation should include **all requested targets**. Keep canonical windows as dependency/evidence groups inside that one request, rather than serial requests or one invented contiguous dialogue. Do not change persisted group schema or hash semantics to implement transport aggregation.

1. Validate duplicate/unknown IDs and select current targets as today; create `reviewWindows` from the full sorted chronology.
2. Retain only windows containing selected targets. Construct a deduplicated cue table for the union of their complete `window.context` arrays. Use each cue's original full-timeline ordinal as a short numeric wire ID, with a request-local ordinal-to-original-ID map. Ordinals are aliases, not persisted cue IDs.
3. Supply `cues: [{n, startMs, endMs, sourceText, translatedText}]`, `groups: [{targets: [n,...], context: [n,...]}]`, mode and canonical rubric. Target IDs are exactly the user's complete selection, never neighbours implicitly added as targets. Each group context remains chronological and identical between a full scan and selected recheck. Full-timeline ordinal preserves gaps rather than renumbering distant selected cues as consecutive dialogue.
4. Prompt the model to inspect groups locally while grading every selected target in one response. Evidence for each target may reference only that target's group. Whole-request cue availability does **not** permit evidence from another group or global narrative assumptions beyond that bounded context.
5. Proposed compact output: `{"a":[[0,[]],[1,[["source.context_inconsistency","简短具体原因",[1,2]]]]]}`. Each assessment tuple is `[targetOrdinal, issues]`; each issue tuple is `[canonicalRuleId, reason, evidenceOrdinals]`. Keep full rule IDs for readability/stability; avoid a second opaque rule-number mapping. Explicit `[]` still means evaluated none; sparse findings-only output is unacceptable.
6. Use strict Zod tuples/closed rule enums and bounded counts. Reject noninteger/unknown/context-only/duplicate target ordinals, duplicate evidence, omitted targets and additional fields. Normalize aliases back to the existing strict internal `{assessments:[{segmentId,issues:[{ruleId,reason,evidenceIds}]}]}` shape without inferring missing data.
7. **Validate per original group** with `validateAssessments(normalizedGroupTargets, originalTargets, originalWindow.context, mode)`. Never pass the deduplicated whole-request table as its `context` argument: gaps would become neighbours, evidence membership would expand and persisted group fingerprints would understate dependencies. Apply report materialization/merge and unchanged-identity ignored-intent logic after all groups validate.

The compact none tuple for 1,027 ordinals needs about 9 KiB in one JSON array; the current UUID/object representation is considerably larger. This reduces output pressure but does not guarantee any model can return arbitrarily many issues or fit a particular provider context. Do not claim one-shot review is always faster or equally accurate without actual provider evidence.

### Application budgets and progress

- Retain the existing oversized-individual-cue rejection and canonical-context budgets. Add a measured complete serialized prompt budget (including rubric, groups, cue table, mode and correction instruction reserve) and selected-target ceiling before obtaining a model result. Suggested starting *application* limits for planning: 2,000 targets / 512 KiB UTF-8 prompt; these support ordinary anonymous 1,027-cue fixtures but are not a claim of provider token capacity. Root should settle concrete bounds in the reviewed design; test exact boundaries with Unicode and JSON escaping.
- Provider capability varies by selected model/custom endpoint. No static character-to-token estimate can certify fit. Preserve existing `TRUNCATED`, HTTP, timeout and response-size guards; show an actionable message to select a smaller set or configure a more suitable model. Never silently restore serial batching on oversize or truncation.
- One non-streamed generation provides no real per-cue intermediate coverage. Show “preparing N targets”, “waiting for complete JSON”, “validating”, “correcting output (1/1)” and validated final coverage; use indeterminate waiting rather than fabricated percentage progress. Cancellation must cover generation, correction, parsing/validation and immediate pre-publication checks under the existing continuous lease.
- If provider output-token settings are later introduced, make them explicit per-profile/protocol capabilities with validation. Do not blindly raise Anthropic limits or copy new OpenAI field names across all compatible endpoints as part of this change.

### Bounded evidence/shape correction

Permit **at most one extra full-selection logical generation** after `INVALID_JSON`, `REVIEW_INVALID`, `REVIEW_IDS`, `REVIEW_INCOMPLETE` or `REVIEW_EVIDENCE`. It must receive the identical original target/context payload plus a bounded diagnostic instruction, not a reduced target list or an incomplete report. This exception to the usual one-request path must be visible (“纠正返回格式/证据 1/1”). Existing transport retries remain separately bounded; one logical generation is not a promise of exactly one HTTP attempt during transient network failures.

For evidence errors, expose trusted validator diagnostics: target alias, rule ID, available adjacent aliases and required neighbour count. Require the model to re-evaluate the actual evidence; it may remove an unsupported claim only after genuinely re-evaluating the supplied dialogue. Main must **not** add invented evidence IDs, clamp risk, transform an invalid issue into an empty issue list, or accept partial results. Strong initial examples for the two contextual-medium rules are currently missing from the explicit prompt prose; enumerate their exact adjacent-evidence requirement as well as the sustained-high requirement.

Do not retry model content for `CANCELLED`, `TRUNCATED`, provider timeout/network/auth/rate errors, input budgets, stale revision/provider or refusal. Avoid reflecting raw provider output or subtitle text into diagnostics/logs; Zod/parser errors can carry content. A bounded prompt correction does not need the entire malformed response included. Failure after correction retains the previous complete report and yields the original actionable issue type with recovery guidance. Cancellation after a validated draft still prevents publication.

### Profile/setup and standards integration

Root's confirmed missing-profile and unchecked-count diagnoses are accepted without repeating personal-data inspection. Prefer an enabled AI-review action that opens a scoped service picker when absent/dangling, offering existing text profiles and configuration access. Do not silently choose an arbitrary first profile or reuse translation credentials. Persist an explicit user choice, then review using the resulting current job revision; invalid/removed profile errors remain actionable from main.

Keep standards content but move its display into the existing accessible modal infrastructure, independent of list scroll. Coordinate App/SubtitleList ownership with the layout child. The aggregate review implementation belongs in `reviewDraft`, so manual selected/full review and automatic-loop initial/rechecks remain identical and retain operation ownership.

### Required regressions

- 31+, 65 and anonymous 1,027 targets cross old boundaries with exactly one successful logical generation; all selected targets appear exactly once. Check request count at actual mock HTTP endpoint, not only helper invocation.
- Sparse/disjoint selected ordinals use one request while containing their complete original groups and no fictional adjacency. A globally present cue outside the target's group cannot serve as evidence; cue at group boundary can use the actual admitted neighbouring cue.
- Compact tuple schema rejects unknown/fractional/negative/context-only/duplicate/omitted target aliases, malformed tuple lengths, unknown rule IDs, duplicate/unknown/cross-group evidence, translation in original-only mode and impossible severe timing.
- Initial malformed output/evidence -> one complete correction -> success. Repeated malformed/evidence -> fail after two logical generations, previous report unchanged. Truncation/auth/timeout/cancel produce no corrective generation. Cancel during correction or between validation/publication preserves previous report.
- Budget rejection is preflight/no generation; exact max, Unicode-byte/escaping and oversized-cue boundaries have actionable errors. Do not split excess targets automatically.
- Full and selected reports produce exactly the old canonical group IDs and local invalidation behavior; neighbour edit/insert/remove invalidates dependent none assessments, unchanged independent groups remain current, fresh ASR IDs do not inherit grades, applicable ignored intent persists only with unchanged identity.
- Re-run all automatic-loop range/category routing/final recheck/cap/source-only/lease/cancellation regressions after changing `reviewDraft`.
- First 269/1,027-cue fixtures lacking a report show every cue unchecked. Missing and dangling review-profile flows permit explicit setup. Standards modal opens from list bottom and remains usable at default and minimum window; focus/Escape restore correctly.

## Related specs

- `.trellis/spec/shared/subtitle-review-reprocessing.md`: fixed rubric/evidence, explicit none, canonical context groups, atomic report publication, bounded review and continuous automatic-repair ownership. Update the transport section after approved implementation: windows remain canonical dependencies, while one generation combines all selected groups.
- `.trellis/spec/backend/type-safety.md`: Zod-first strict wire schemas, inferred types and no non-null assertions.
- `.trellis/spec/backend/error-handling.md`: trusted structured AppError diagnostics and atomic retention.
- `.trellis/spec/frontend/components.md`: semantic controls/accessibility and usable independent scroll regions.
- `.trellis/spec/frontend/electron-browser-api-restrictions.md`: use app modal rather than prompt/alert/confirm.

## External references / versions

No external provider-capability assertions are needed for the design. All protocol limits above are observations of current repository code, not provider documentation or current model capabilities. Future endpoint/model output-capability changes require official documentation verification and endpoint compatibility tests.

## Caveats / Not Found

- This is new scope in planning, not implementation authorization. Do not change product code or use real personal projects to test it before the updated plan is reviewed.
- The suggested aggregate application budgets are a design proposal requiring final selection, not established existing behavior. Input-byte limits cannot promise output/context fit for arbitrary provider profiles.
- Existing code has no streaming per-target review evidence or profile-specific output token setting. No speed/quality benchmark was performed and no external/paid AI was called.
- Canonical windows deliberately restrict evidence. Aggregating requests must not quietly expand analysis semantics while storing only local dependency fingerprints; broad global dialogue review would require a separately designed dependency model.
- `tests/e2e/helpers.ts` and contextual native tests currently parse `{selected,context,...}` prompt lines. They must be upgraded alongside the new wire model instead of retaining a production compatibility path solely for fixture convenience.
