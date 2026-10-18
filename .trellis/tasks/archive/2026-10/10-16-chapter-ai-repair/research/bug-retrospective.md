# Bug analysis: mixed-script names and chapter repair boundaries

## 1. Root cause category
Names: implicit assumption (E) plus coverage gap (D). The word matcher treated every Unicode letter next to a Latin edge as continuation of the same word. Japanese/Chinese naturally place names next to Han/Hiragana/Katakana; exact observed aliases were rejected as unsupported evidence. Two original complete failed responses ground successfully after the script-aware fix (8/8 and7/7 candidates). Diagnostic metadata lacks a captured revision, so original snapshot equivalence remains a stated caveat.

Repair integration: cross-layer ownership contract (B). Fresh ASR can merge cues across chapter boundaries. Assigning the new cue only to its first owning chapter leaves another chapter unable to represent a legitimate merge; independent per-chapter choices can also duplicate or drop speech at full-round aggregation.

## 2. Why the initial interpretation was insufficient
Adding a bounded name correction alone would leave valid mixed-script aliases unmatchable. The initial inference that strict validation implied model hallucination was corrected after readonly original diagnostic inspection. Keep strict evidence, but fix the matcher itself. No unsupported claim is accepted merely to suppress an error.

Chapter-local ID membership and a complete list of target keys do not establish per-target replacement coverage. Mapping distant targets to one unrelated output can still delete content. Same-ID dedup alone also misses new cross-ID overlapping output (merged M plus retained old B).

## 3. Prevention mechanisms
| Priority | Mechanism | Action | Status |
| --- | --- | --- | --- |
| P0 | Test coverage | Positive mixed CJK/Latin and mixed Katakana-Latin names plus true-fragment/mark/digit/underscore negatives | Focused tests and final independent 935-test suite passed; actual mixed-script name request published |
| P0 | Independent evidence | Replay complete original responses privately, not merely the first failing alias | Both responses pass with sanitized structural evidence |
| P0 | Runtime validation | Per-target fresh/source/output linkage, shared crossing evidence, consistent full-round merge and conflict rejection | Independent repair review and all 66 repair integration cases passed |
| P0 | Lifecycle checks | Explicit unchanged-result invalidation and persisted final pending closure incl none | Unit/integration and native success/failure/cancel passed; actual repair/current grades/restart/export passed with honest cap+remaining findings |
| P1 | Executable specs | Updated person-name-review, ai-chapters-and-artifacts, subtitle-review-reprocessing and operation-workspace | Independent final source/spec review passed |

## 4. Systematic expansion
The same literalNameSpans powers analysis/apply/undo authority, so the fix and tests cover all callers rather than bypassing grounding at one call site. Chapter review metadata merges and repair publication require full-round invariants in addition to valid individual model responses. Preserve inherited legitimate overlapping ASR cues while rejecting newly introduced conflicting coverage; a blanket ban on all overlap is not a safe substitute.

## 5. Knowledge capture
Code-spec contracts record the two recognition/names chapter exceptions, complete-context one-request phases, shared service limits, final-consistency semantics and script-aware boundaries. Independent review and actual-provider tests remain separate from implementation self-checks. Evidence and acceptance state must survive quota interruptions without claiming incomplete checks passed.
