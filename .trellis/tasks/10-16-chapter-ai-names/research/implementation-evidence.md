# Names implementation evidence

## Reproduced behavior and diagnosis

The existing prompt already requires literal aliases separately from canonical recommendations. Strict exact-case/field evidence and recurrence across at least two distinct cues remain required. However, the original boundary implementation was too broad: its `\\p{L}` continuation class rejected Latin edges touching Han/Hiragana characters in natural unspaced CJK dialogue. Mixed Katakana/Latin names and Latin names in Chinese translations therefore failed despite exact literal evidence. A single rejected alias failed the entire response, and `analyzeNames` immediately failed without content recovery.

Independent readonly inspection of two original installed-client failed diagnostics established the real boundary bug. Sanitized evidence: `../../10-16-chapter-ai-repair/research/original-names-diagnostic.json`. The original project is Japanese to Simplified Chinese. Every rejected alias was a literal substring; rejected edges touched only Han/Hiragana rather than longer Latin words. Request revisions were not recorded, so the evidence includes the caveat that the current timeline may differ from the exact request snapshot.

The targeted fix allows CJK letters to delimit a Latin/Greek/Cyrillic edge while retaining conservative continuation checks for other letters, all digits, combining marks and underscores. No normalization, fuzzy matching or evidence bypass was added. Synthetic actual-shape fixtures prove direct successful grounding, simultaneous apply and undo for mixed Katakana/Latin and Chinese-adjacent Latin names, while preserving distinct longer names. Separate recovery tests reproduce genuine unsupported canonical aliases, wrong fields, case mismatches and partial words; those are general model-output failures, not the observed original cause.

## Change boundary

Keep one entire chronological timeline request and strict field-specific exact matching/apply/undo rules, correcting only the erroneous CJK-adjacent word boundary. Add one visible whole-request regeneration only for JSON/shape/evidence/conflict failures. Feedback contains trusted candidate/field/alias ordinals, never model-provided explanations or a replay of rejected output. Keep the identical full subtitle payload, run identity and explicit request attempt. Transport/auth/rate/truncation/cancel failures do not trigger content correction. Failed or cancelled correction preserves the previous report and content.

Chapter plans are never prerequisites. Tests cover absent, stale, custom and multiple normal chapters, unchanged prompt/plan state, and report applicability after chapter-only edits. Provider transport owns the shared profile concurrency limiter, so names needs no chapter scheduling integration.

## Checks run

- `npm test -- tests/unit/backend/person-names.test.ts tests/integration/backend/person-names.test.ts`: 2 files, 85 tests passed under the Electron ABI wrapper after the targeted CJK boundary fix (previous checkpoint: 60 tests).
- `npm run typecheck`: passed.
- Scoped ESLint over the three product files and four touched test/helper files: passed.
- New native E2E correction/terminal-retention scenario added to `tests/e2e/person-names.spec.ts`; execution deferred to integrated build because other teammates are actively editing the shared build inputs.
- No paid provider calls, production project edits or commits were made.

## Live verification handoff

The installed client runs from `F:/Soft/Slice Man/Slice Man.exe`. No listening debugging port was observed. The prior ignored bridge `.native-smoke/ui-refinement-20261015/run-project-live-secure.cjs` demonstrates isolated access: open `%APPDATA%/slice-man/app.db` readonly; copy only protected `os_crypt` metadata from `Local State` into isolated bridge userData; decrypt the selected configured profile key in Electron memory; serve one readonly project copy over a random one-shot loopback route; pass temporary credentials to the isolated test child environment, and persist sanitized counts/status only.

Do not rerun that old wrapper unchanged: it targets an earlier failed chapter request, old request budget and earlier evidence paths. The leader should adapt it for this authorization, a fresh durable ledger and the selected current names/project record. The original app/process/data must remain untouched. Readonly inspection of an original `NAMES_EVIDENCE` diagnostic answer can establish the actual unsupported alias before making any new paid request; answer artifacts are under the installed userData `ai-responses/<request UUID>/answer.complete.txt` and must never expose reasoning or whole subtitles in logs.
