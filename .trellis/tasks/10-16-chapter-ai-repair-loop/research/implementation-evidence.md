# Chapter repair implementation evidence

## Ownership and continuity

repair_resume continued the interrupted repair implementation in the shared
working tree. The core, names and progress teammates' changes and unrelated
AGENTS/workflow/seeking-helper edits were preserved. No commits, task archive,
paid requests or shared builds were performed by this teammate.

## Changed repair scope

- `src/main/services/jobs/lib/job-service.ts`: repairLoop orchestration only;
  chapter checks, fresh recognition/translation, parallel old/new adjudication,
  atomic round publication, reassessment, final consistency and bounded exit.
- `src/main/services/jobs/lib/repair-loop.ts`: every qualifying risk category
  receives fresh ASR, with enabled translation downstream; explicit repair-grade
  invalidation also applies when audited text/timing remains unchanged.
- `src/main/services/jobs/lib/repair-adjudication.ts`: new strict request/output
  validator and complete-round aggregation helper.
- `src/shared/reprocessing-contracts.ts`: repair adjudication and
  final_consistency phases.
- `tests/integration/backend/reprocessing.test.ts`: focused deterministic
  integration, timing/evidence/publication and final-consistency regressions;
  superseded category-only routing expectations were replaced by actual
  all-category fresh-ASR/translation assertions.
- `tests/e2e/repair-loop.spec.ts`: multi-chapter unchanged/capped repair,
  concurrent cancellation and three pending-after-final-reassessment cases.
- `tests/e2e/helpers.ts`: surgical repair audit responses and isolated review
  delay/hold controls used by the new desktop cases.

The large job-service diff also contains other teammates' core/names work; this
report does not attribute their implementation to repair_resume.

## Verified repair behavior

- Missing assessments are checked by chapter with complete context. Each
  qualifying target receives fresh ASR and enabled translation, including
  translation-only findings. Source-only performs zero translation.
- Old and new full chapter times/source/translation, explicit targets and prior
  suspicion are supplied to one adjudication request per affected chapter.
  Target maps must be complete; output IDs/text/timing/language mode are validated
  before one atomic whole-round content publication.
- A mapped old output must overlap its original target. Fresh outputs require
  original-fresh-to-target and audited-output-to-original-fresh temporal links.
  Disjoint IDs, moving unrelated fresh evidence onto a target and global
  interval-membership shortcuts cannot satisfy target coverage.
- Cross-chapter merged ASR evidence is available to every overlapping target
  chapter. Identical shared output IDs are published once; differing outputs
  reject the entire round. Newly introduced mixed old/fresh overlap and widened
  overlap are rejected. Existing old-old and native fresh-fresh overlap may be
  retained within its original intersection.
- Explicit empty mappings can represent a target with no linked fresh timing
  evidence even if its neighbour in the same effective interval has speech.
  Missing mappings or empty mappings for a target with fresh evidence fail.
  These timing guards are not a claim of acoustic correctness.
- Empty/whitespace audited source text and incomplete/stale enabled translation
  are rejected. Silence must use explicit target mapping rather than invisible
  empty text.
- Original/replacement assessments are invalidated even for unchanged content.
  Fixed scope remains fixed; expanded/new cues and newly invalidated dependency
  assessments become required final coverage. Unrelated outside-scope cues
  already pending before the run do not cause additional paid checks.
- Final consistency is assessment-only and drains required missing/recheck
  grades, including none, independently of threshold. Persisted coverage is
  reread before success. Failure/cancel/nonprogress remain incomplete, retaining
  prior committed content and honest pending state.
- If final consistency reveals a newly eligible scoped target while budget
  remains, actual repair continues. Final consistency itself spends no repair
  round; max_rounds is only reported when the actual cap has been consumed.
- Existing cancellation, stale revision/provider, continuous operation lease,
  fixed range, expanded overlap, ignored-risk eligibility and failed-draft
  atomicity cases remain covered.

## Executed checks

repair_resume final focused command:

`npm test -- tests/integration/backend/reprocessing.test.ts`

Result: **66 passed**, 1 file passed, 15.77 seconds. The repository wrapper runs
Vitest under the Electron SQLite ABI. This includes actual isolated SQLite and
FFmpeg crops with deterministic provider mocks; no paid requests or acoustic
accuracy claims are implied.

`npm run lint`: passed after final desktop test additions.

`npm run typecheck`: passed after final desktop test additions.

repair_check subsequently independently reread the final repair diff and ran
the final **66 passing focused tests plus lint and typecheck**. The leader
reported no remaining concrete independent-check findings.

## Desktop and paid verification handoff

verification_resume owns serialized build/full Electron E2E and authorized
actual-service testing. These results are pending that teammate's report and
must not be inferred from deterministic unit/integration success.

The three new final-consistency desktop cases use an isolated SQLite trigger
that marks a surviving none-grade cue pending exactly on entry to the final
phase, after the last reassessment. Each case checks the additional one-target
request with full chapter context, unchanged repair round/content/revision,
success versus failure/cancellation metadata, current/stale UI badges and
persisted agreement after restart. They emit Playwright screenshots and JSON
attachments. Their execution evidence is to be supplied by verification_resume.
