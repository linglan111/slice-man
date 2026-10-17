# Feature guide and release metadata follow-up — 2026-10-18

## Scope and implementation

The six-step informational guide retains its existing Modal, navigation, focus announcements, replay and dismissal behavior. Only copy and the existing relevant unit assertions changed. No provider, project, layout or settings action was added.

- `src/renderer/src/components/FeatureGuide.tsx`: locate default2/integer1–16 shared text concurrency in API service settings; explain reusable full-text chapters for short and long videos; remove the old30-minute review gate and category-based repair routing; explain whole-timeline names and ASR chapter exemption, all active/queued requests, fresh recognition/translation with contextual old/new audit, final pending-assessment check without another repair round and honest failure/cap outcomes. Describe operation switching with45% capped fit, temporary manual divider adjustment and local scrolling. Preserve the upper-left help and lower-left settings guidance.
- `tests/unit/frontend/FeatureGuide.test.tsx`: update the existing six-step traversal assertions for those current capabilities while retaining announcement/focus, previous/next/finish, dismissal and replay coverage.
- `package.json`, `package-lock.json`: synchronize stable version0.1.5 in package metadata and both lock root locations. No dependency change, installation or Git operation.

## Focused checks

- `npm test -- tests/unit/frontend/FeatureGuide.test.tsx tests/unit/frontend/AppFeatureGuide.test.tsx`:2 files,11 tests passed using the repository Electron test wrapper.
- `node --test scripts/release.test.cjs`:12 passed,0 failures/skips.
- Inspected scoped diff: production guide changes are strings only, metadata changes are exactly three version values.

Independent reviewer `release_check` was notified after the final code/metadata edit and owns final static checks plus native guide geometry. Guide spec synchronization is owned by the leader. Native layout evidence is intentionally deferred to that independent review; the jsdom results do not establish native geometry/focus trapping. No paid calls, packaging, full regression or Git mutation performed by this implementer.
