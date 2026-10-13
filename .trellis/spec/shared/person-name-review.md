# Recurring person-name analysis, batch replacement and undo

## 1. Scope / Trigger
Read before changing name analysis, bulk subtitle naming, optional Job nameReport/nameBatch, undo, profile applicability or text/emphasis invalidation. Shared strict schemas live in `src/shared/person-name-contracts.ts`; main helpers in jobs/lib/person-names.ts; JobService owns operation/revision/publication and Store refreshes report applicability. Recommendations are text hypotheses requiring user confirmation, not acoustic speaker identification.

## 2. Signatures
```typescript
api.jobs.analyzeNames({ jobId, revision }): Promise<Result<Job>>;
api.jobs.applyNames({ jobId, revision, reportId,
  mappings: [{ candidateId, sourceName, translatedName, enabled }] }): Promise<Result<Job>>;
api.jobs.undoNames({ jobId, revision, batchId }): Promise<Result<Job>>;
```
All new channels require allowlisting, strict input/output validation, typed preload and thin main handlers. Progress stage `names` is transient operation status, not a new fixed recognize/translate/export pipeline stage.

## 3. Contracts
- Optional version1 `Job.nameReport` has report/profile identity and fingerprint, inspected revision, mode/timeline fingerprint, created time, current/stale state and locally grounded candidates. Optional version1 `Job.nameBatch` has batch/revision/time identity, available/consumed state, text/emphasis patches and terminal undo summary. Legacy jobs omit them without relational migration.
- Analyze under one main controller/lease with the explicitly selected independent review text profile. Existing text is data, not instructions. One structured JSON request covers source and active translation; original-only omits translation data. Use app2000-cue/512KiB complete UTF-8 prompt bounds; no serial fallback or guaranteed model capacity. Cancel/error/stale provider/key/mode/revision preserves previous report.
- The analysis request contains the entire chronological timeline, including cue ordinal/ID/timing and language mode. Resolve same-person identities across distant cues from shared dialogue/context, grouping exact observed ASR and translated spelling variants into one candidate even when each individual variant appears only once. Explain the identity evidence and recommended canonical spelling in Chinese. Similar spelling alone is insufficient; distinct people stay separate and uncertain variants are excluded. AI proposes exact field-specific aliases and recommended original/translated names/reasons; main enumerates literal occurrences and computes counts without fuzzy matching. Require >=2 distinct cues per candidate across all aliases, not two repetitions in one cue or two repetitions of each alias. Reject hallucinated aliases, duplicate incompatible claims, malformed output and unsupported source-only translated proposals.
- Bound candidates200, aliases16 per field, names120 UTF-16 units, reason500. No blank replacement. Latin/Greek/Cyrillic/alphanumeric edges use Unicode-aware word boundaries including marks/digits/underscore; Ann never matches Anna. Exact case and spelling, no implicit normalization/regex construction. CJK literal matches require visible context; single-character CJK aliases are excluded. Matching must read neighbouring code points locally rather than allocating complete text prefixes for every hit.
- Apply uses current revision/report identity and freshness, resolves stored candidate IDs and rechecks grounded spans/counts. Draft all fields simultaneously from original text: same-candidate nested aliases choose longest; distinct selected candidates overlapping or incompatible shared aliases reject the whole batch. Never cascade A->B->C. Final fields retain20000-unit limits; validate entire timeline/style before one save/revision increment.
- Preserve IDs/times/unrelated text/global style/historical outputs. Changed source conservatively makes that cue's translation stale even if translated names also changed; translated-only changes retain existing staleness. Invalidate derived preview/export and dependent review/name applicability. Prune only invalid emphasis references on changed primary text and save minimal per-entry before/after patches.
- Store list/get/save refresh nameReport against cue IDs/time/source/active translation/mode/configured review profile; material provider changes mark it stale. Styling alone does not stale a text report. Applying requires current provider fingerprint, but undo needs no AI service or current report.
- Successful non-no-op apply stores only the latest batch. No-op/cancel/failure does not replace undo or increment content revision. Preflight `NAME_MAX_PATCHES=20000` and `NAME_UNDO_TEXT_BUDGET=2000000` cumulative before/after UTF-16 units plus bounded emphasis/conflict schemas BEFORE publication; a successful batch always has its promised undo.
- Undo uses CURRENT revision and batch ID. Each `(segmentId,field)` is restored only if current text equals batch after; otherwise preserve that entire field and report changed/missing. Deleted/re-recognized IDs are not recreated. Other fields/cues/times/global styles remain. Minimal emphasis restores only if current entry equals after and restored keywords exist in current primary text. Source undo retains conservative translation staleness, never restores old whole stages/reports/exports.
- Consume attempted undo with restoredFields/restoredEmphasis/skippedFields and conflicts; increment content revision only if text/style changed. Conflict-only attempt persists terminal metadata without content revision. No redo/multi-level history. Exact-value ABA is not distinguishable without an edit ledger; do not claim historical provenance or surgical substring reversal after same-field edits.

## 4. Validation & Error Matrix
| Trigger | Result |
| --- | --- |
| Busy/stale revision | JOB_BUSY/STALE_REVISION, no provider/write |
| Missing profile/no cues/oversize request | PROFILE_MISSING/NO_SEGMENTS/TEXT_LIMIT before generation |
| Invalid proposal or source-only translated result | NAMES_INVALID; prior report preserved |
| Alias absent or <2 distinct cues | NAMES_EVIDENCE; no partial candidate report |
| Duplicate incompatible aliases/selected overlapping spans | NAMES_CONFLICT; whole batch unpublished |
| Stale report/provider/text or corrupted occurrences | STALE_NAMES or trusted validation failure; no content mutation |
| Invalid resulting field/timeline/style or undo-budget excess | Entire batch unpublished; previous undo retained |
| Later edited/deleted field during undo | Preserve field, record changed/missing conflict; safe fields may restore atomically |
| New successful batch replaces old ID / already consumed undo | NOT_FOUND/NAMES_UNDO_USED, no repeated undo |

## 5. Good / Base / Bad Cases
- Good: two grounded John/约翰 cues show editable recommendations; apply once; manually edit a different cue; restart and undo names while retaining that edit.
- Base: same-field manual edit after apply is preserved wholesale and listed as skipped, while untouched batch fields restore.
- Bad: replace Ann inside Anna, cascade replacements, trust model counts, call translation in original-only mode or restore a saved whole timeline over later edits.

## 6. Tests Required
- Unicode punctuation/combining/surrogate boundaries, literal regex metacharacters, CJK caveats, long repeated text counts, longest same-person alias and cross-person overlap/noncascade swaps.
- Actual occurrence/count grounding, malformed/hallucinated/source-only/empty/oversized/cancelled/stale analysis; revision/provider/key identity; no partial report.
- Atomic apply/no-op/length/budget/report-span corruption guards, source+translated staleness, context-none invalidation, minimal emphasis preservation and zero ASR/translation calls.
- Current-revision undo with later other-field/cue/time/style changes, same-field/deletion/new-ID conflicts, mixed safe/skipped, emphasis CAS, latest replacement/no-op retention, consumption and restart/legacy schemas.
- Real Electron IPC/mock HTTP analyze/edit/apply/cancel/undo/restart/conflicts; visible minimum-window actions and corrected export. Fixtures prove plumbing and integrity, not name accuracy.

## 7. Wrong vs Correct
Wrong: invoke editSegment repeatedly for one batch, then restore the old Job to undo; earlier writes survive errors and later edits disappear.

Correct: validate one complete draft/undo record and publish once; undo current fields with compare-and-swap and explain conflicts while preserving unrelated state.
