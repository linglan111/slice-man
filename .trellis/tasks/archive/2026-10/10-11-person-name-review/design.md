# Person-name analysis and batch undo design

Status: approved2026-10-11; implementation in progress. Research: parent `research/person-names.md`.

## Boundaries and contracts
Add strict `person-name-contracts.ts` and optional Job `nameReport`/`nameBatch`; legacy saved jobs remain valid without relational migration. Extend channel allowlist, typed preload, strict IPC inputs/outputs/progress and thin main handlers together. Proposed APIs:

- `jobs.analyzeNames({jobId,revision}): Result<Job>`
- `jobs.applyNames({jobId,revision,reportId,mappings:[{candidateId,sourceName,translatedName,enabled}]}): Result<Job>`
- `jobs.undoNames({jobId,revision,batchId}): Result<Job>`

Analysis uses the explicitly selected review profile and one main controller/lease. Structured JSON proposes source/translated aliases, canonical recommended values and short reasons. Main independently resolves literal occurrences, derives counts and candidate IDs, then publishes only after abort/revision/mode/profile/key-identity checks. Text is data, not instructions. Use the reviewed aggregate prompt budget helper: 2000 cues / 512 KiB UTF-8 prompt; no silent serial fallback. No ASR/translation calls occur during names analysis/apply/undo.

Bound report to 200 candidates, 16 aliases per field per candidate, and 120 UTF-16 units per alias/replacement; reject empty/whitespace-only names and unsupported fields. Require recurrence in at least two distinct cues across applicable fields; show locally calculated per-field/total counts and snippets. Ground every alias in actual text, reject hallucinated/duplicate incompatible alias claims rather than silently mark analysis complete. Recommendations initialize editable inputs but never change content automatically.

Report freshness includes cue IDs/times/current source/active translation/mode and material review profile fingerprint; content/profile changes make apply unavailable until rescan. Credential changes do not rewrite stored conclusions. Undo uses its own batch/current-value guards and works without a current AI report or credentials.

## Matching and atomic replacement
Literal exact-case/code-point-safe matching, no user-built regex or implicit Unicode/case normalization. Latin/Greek/Cyrillic/alphanumeric edges require Unicode-aware word boundaries including combining marks/underscore/digits; Ann does not match Anna. CJK exact literal hits are not proof of person identity: exclude one-character CJK aliases from initial AI recommendations, show context and let users deselect. Separate source and translation namespaces; original-only ignores stored translated text and forbids translated mutation.

Resolve spans against the original field once and replace simultaneously. Same-candidate nested aliases choose the longest span; overlaps between selected candidates or incompatible targets reject the whole batch. No cascading A->B->C. Validate final 20000-unit field limits and complete timeline before publication. No-op does not increment revision or replace prior undo.

Draft every changed field plus minimal emphasis-keyword updates; publish once via Store.saveJob with one content revision. Preserve IDs/times/unrelated text/style and export history; invalidate derived preview/export, name report and dependent review grades. Changed source conservatively makes its translation stale even when translated names were also replaced. Translated-only edits preserve existing staleness. Remove only emphasis references invalidated by changed primary text, recording minimal per-entry before/after patches, never an entire style snapshot.

## Persistent latest-batch rollback
Each text patch stores `(segmentId,field,before,after)`. Preflight at most 20000 patches and 2000000 cumulative UTF-16 units of before/after strings, with bounded emphasis/conflict metadata. Reject oversized apply before any write so every successful batch has its promised undo. Only a newer successful non-no-op batch replaces history; failed/cancelled/no-op actions preserve the last record.

Undo checks the CURRENT revision and batch ID. Current field equal to after -> restore before; changed/deleted/re-recognized field -> preserve and report conflict. Different fields/cues/times/global style edits survive. A later manual edit returning text exactly to after is indistinguishable without a field history ledger; no claim of historical provenance. Same-field substring surgery is deliberately excluded.

For emphasis entry restore require unchanged after-entry plus valid keyword in current primary text; otherwise retain entry and report conflict. Validate the combined safe inversions, publish once, and consume the record with terminal restored/skipped summaries. Increment content revision only when text/style changes; conflict-only attempt may persist summary without content revision. Preserve translation staleness and historical stages/reports/output records; never restore old whole Job. No redo/multi-level history or restart auto-action.

## UI, compatibility and validation
Two-column toolbar panel has analyze, editable checked candidates with counts/context, explicit apply/cancel and undo summary. Busy/stale/prerequisite states explain why actions are unavailable. Original-only hides translated inputs. Scrollable candidate content retains visible action footer at minimum native window; focus and keyboard work through existing semantic controls.

Pure matcher tests cover Unicode, literal metacharacters, nested aliases, swaps/cascade and conflicts. Isolated service integration verifies strict IPC, analysis grounding, lease/freshness, whole-batch atomicity, staleness/emphasis, current-revision undo after later edits, deletion, bounds, latest-batch replacement and restart. Native mock HTTP test exercises analyze/edit/apply/cancel/undo/conflicts/restart and exports; paid AI quality is not asserted.
