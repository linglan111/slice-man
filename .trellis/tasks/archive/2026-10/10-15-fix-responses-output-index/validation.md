# Responses repair verification

Date: 2026-10-15. Branch: codex/ai-chapters-resumable-tools.

## Reproduction and repair

- Read-only installed diagnostics: chapter planning failed with STREAM_PROTOCOL after a long reasoning-only stream, preventing long-video review. Production in-memory reproduction rejects official message index1 after reasoning index0.
- Fix Responses output-item/content-part semantics in the shared parser, retaining bounded indexes, identity/order/final-text validation, refusal/tool/truncation/incomplete rejection and no reasoning persistence.
- Initial patch introduced a second assumption (all content parts belong to messages). First real allowance3 calls exposed it. Revised fixtures first reproduce six failures, then pass after reasoning_text lifecycle handling. These failed attempts remain in evidence.

## Final source checks

- Independent reviewer re-ran provider/protocol/HTTP/SQLite suites:89 passed. Global lint and TypeScript pass.
- Full unit/integration:77 files,771 tests passed; `.native-smoke/responses-fix-all-unit-final.log`.
- Production build passes; `.native-smoke/responses-fix-build-r2.log`.
- Final complete local native Electron suite:42 passed,4 explicitly gated live tests skipped,0 failures (46 cases,5.0 minutes); `.native-smoke/responses-fix-full-e2e.log`.
- Added real Electron scenario streams the full reasoning0/content lifecycle + message1/two textparts over HTTP; chapters/review/names publish with exact answer files, no reasoning and restart persistence. Existing native CPU/CUDA, playback, correction, exports and layouts remain passing.

## Actual live service verification

The user separately authorized two allowances of at most3 synthetic requests each. First allowance3 failed at the newly introduced content-part assumption. After correction, second allowance3 all passed in actual Electron UI using the configured official DeepSeek origin/model/Responses mode and unchanged SSE transport. Ledger entries are HTTP200/streamActual/published with positive normalized answer bytes and response.completed terminals. A synthetic two-cue four-second project was used. No user's video or personal subtitles were uploaded or modified.

- Chapter planning:published,202 answer bytes; reasoning output0 followed by text output1, both content-part types observed.
- Subtitle check:published,105 answer bytes; two current assessments saved.
- Names:published,314 answer bytes; current grounded global-name report saved.

The live test passed in about1.1 minutes. Cumulative calls=6 (3 early failed +3 final successful), within the two explicit authorizations. No further live calls were made. Sanitized metadata is in `evidence/live-round1-metadata.json` and `evidence/live-round2-metadata.json`; no credentials, prompts, reasoning or personal content is stored there. Answer files for synthetic content stay in ignored isolated test data. Session-only credentials and disabled trace/video/failure screenshots prevent secret recording.

## Limits and delivery

This establishes actual DeepSeek streaming plus small chapter/review/name workflow compatibility, not full-video model accuracy, guaranteed latency or token savings. The personal1,027-cue project was inspected readonly and was not reprocessed or edited. Existing other live tests remain opt-in and were not run beyond this allowance. Root will append local verification-installer and packaged startup results once complete; no push, GitHub release or installation into the user's app directory.

## Completed package gate

Source commit:`e46118d30f256ca83a3fc9910e0ef5bdd8b78905`. Local NSIS installer built successfully at `dist/verification-0.1.5-preview.7-20261015` with build-only version override; formal package.json remains0.1.4. Both packaged smoke and additional production verification passed: actual packaged startup, native SQLite, narrow preload/production IPC, fonts/media/notices/native binding, production test-flag isolation, first-run guide and help replay. Isolated package data was used; no installation into the personal application directory. Installer output includes SHA256SUMS, VALIDATION, packaged JSON reports, final unit/native/live logs and both sanitized live ledgers.
