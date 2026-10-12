# First-run guide design

## Architecture and flow

Add FeatureGuide renderer component and onboarding-preferences helper. Reuse native Modal and App's existing single-dialog union, avoiding stacked dialogs. Common-header `?` has title/accessible name 功能导航 and is unconditional. No backend, provider or job schema change for guide state.

After successful startup, open automatically only if unseen and no conflicting dialog/operation is active. Defer instead of replacing user actions; startup failure does not count as success. StrictMode cleanup/re-run must not double-open or consume the decision prematurely. Manual replay may open during active work while subscriptions continue normally.

## Preference and content

Use one recognized versioned seen value in a dedicated renderer storage key; missing/corrupt/unrecognized means unseen. Catch read/write failure and retain in-memory dismissal. Mark seen only on close/Escape/finish, not opening. Opening manually always starts at step one.

Six steps: engine/API preparation; import/generation; preview/right proofreading and draggable/collapsible layout; AI review/ignore; inclusive bounded category-based repair; styles/export. Short explanations and previous/next/finish/close actions. No action links initiate configuration/import/provider/export or mutate layout; copy describes where to go after closing.

The repair step also explains all subtitles versus start/end range reruns, and must match the sibling's approved whole-cue/strict-boundary policy. Dependency: finalize this copy after loop scope and labels are stable; guide component/preferences can be built independently, while shared App integration is sequenced after loop UI work.

## Accessibility and compatibility

Native Modal provides focus containment, Escape and restore; verify actual Chromium behaviour and announce step changes. Readable viewport-bounded content/footer at 1440x960 and 1050x700. Preserve project selection/playback/drafts/options. Upgrades without the key see guide once; localStorage is isolated by application user data/origin, with no dev-to-packaged migration claim.

## Test isolation

Existing App tests explicitly prime returning-user state; dedicated tests exercise genuine unseen storage. Extend native launch helper compatibly with preserveGuide option: default closes only the named guide via real UI after a deterministic settled startup decision. Never add product APP_E2E skip logic or blindly close unrelated dialogs. Same-user-data restart proves persistence.
