# Independent backend/shared review — added R9 and R11 scope

Date: 2026-10-12 (Asia/Hong_Kong). Reviewer: dispatched `trellis-check` agent `/root/check_added_backend`.

## Boundary and reviewed behavior

Reviewed shared schemas/channels/preload/IPC, Store name-report applicability, JobService aggregate review/name operations, pure name matching/apply/undo, review presentation and backend/shared tests. Renderer operation panels and native Electron checks remain separately owned; no personal database, live paid provider, native ABI switch, commit or release operation was performed.

The approved paths preserve one logical complete-selection review generation with at most one visible complete correction; canonical evidence groups remain separate despite the aggregate table. Target membership/coverage, timing/context prerequisites, source-only restrictions and request limits fail before report publication. Names are grounded in at least two distinct cues, stored spans/counts are recomputed before replacement, replacements are simultaneous, and one validated content save retains bounded latest-batch undo. Undo uses the current revision and per-field compare-and-swap, preserves later changes/deletions/global style and consumes a conflict-only attempt without increasing the content revision.

## Findings fixed

1. `src/main/services/jobs/lib/job-service.ts`, `reviewDraft`: publication compared revision/mode/profile/model identity but not the credential used by the request. Added the immediate credential identity guard. Integration regression changes the key during generation and verifies one request, `STALE_REVISION`, and retention of the prior report.
2. `src/main/services/jobs/lib/person-names.ts`: longest-alias acceptance and replacement-overlap validation scanned every previous hit, causing quadratic work on densely repeated names. Longest-first acceptance now marks bounded UTF-16 units; simultaneous replacement checks overlaps after sorting. Unicode boundaries, longest-first selection, cross-person whole-batch rejection and non-cascade behavior are preserved. A 10,000-hit fixture verifies counts, replacements and undo without flaky timing assertions.
3. `tests/unit/backend/ipc-check.test.ts`: disposal still expected 38 handlers after the three names channels were added. It now verifies removal against the complete shared allowlist, catching omitted channels as well as handler leaks.

## Additional regression evidence

- New successful name batches replace the prior undo record; old batch IDs and stale apply/undo revisions reject without consuming the current batch.
- Name analysis rejects credential/model/mode changes during generation and preserves the existing report identity.
- Excessive whole-batch undo storage fails before saving any field or replacing the available undo.
- Names IPC rejects missing/fractional revisions, empty identities, blank names and caller-supplied occurrence/patch authority before service invocation; valid strict payloads pass unchanged.
- Existing suites cover hallucinated aliases, one-cue recurrence, Unicode/combining/surrogate boundaries, literal metacharacters, nested aliases, cross-person overlap, no cascade, source-only zero translation, no-op, cancellation, stale reports, minimal emphasis, later field conflicts/deletions and restart without credentials.

## Verification

- Targeted aggregate review/names tests: 4 files, 95 tests passed after product fixes.
- Targeted names/strict IPC tests: 3 files, 36 tests passed after additional regressions and handler assertion fix.
- Global lint: pass (`backend-added-lint.log`).
- Global TypeScript: pass (`backend-added-typecheck.log`).
- First complete unit/integration run: 60 files, 568 passed / 2 failed out of 570. Both failures are renderer-owned `AppRecognitionReset.test.tsx` helper selectors after toolbar migration; all backend/shared suites passed. Owner/root notified. Log: `backend-added-unit.log`.
- Final complete rerun after the layout owner corrected the real toolbar helper/startup race: 60 files, **570 tests passed / 0 failed**, 22.98s (`backend-added-unit-final.log`). Native SQLite remained on the Electron ABI through the repository's test orchestrator.
- Build/native E2E: delegated to the separate layout/native reviewers; this review does not claim those results.

## Findings not fixed

No unresolved backend/shared correctness finding was identified in the approved scope. The two frontend selector failures were handed to the layout owner, corrected there and passed in the full rerun. Parent `design.md` retained an outdated added-scope approval heading during this audit; root was notified because planning/spec documentation is root-owned.

Spec synchronization: root owns the already-created seven-part person-name contract and aggregate review contract. The credential publication fix and preserved bounded matching behavior should remain reflected in those contracts; no public interface or product decision changed in this review.
