# Guide implementation plan

1. After approval, load frontend components/state/react/dialog/quality and shared native runtime specs.
2. Implement safe versioned seen preference and six-step FeatureGuide using existing Modal; add parsing/storage and navigation unit tests.
3. Coordinate App integration after loop UI work: successful-startup automatic show, single-dialog deferral, unconditional help replay and stable focus/StrictMode behaviour.
4. Add scoped styles and synchronize loop guide text; ensure readable minimum-window actions.
5. Prepare existing App unit fixtures explicitly as returning users; retain dedicated empty-storage tests. Adapt E2E launch helper through actual guide close and optional preserveGuide.
6. Add native onboarding tests for fresh empty/saved projects, close/Escape/finish restart persistence, repeated replay/collapsed sidebar, keyboard/focus, geometry, startup races/error and active-job noninterference.
7. Run targeted frontend/Electron checks then full lint/type/unit/build/Electron regression with the loop child. Delegate final review and E2E evidence verification.

Risk files: App startup effect/dialog union, shared Electron launch helper and App fixtures. Rollback guide integration/component/preference together without altering jobs/layout storage. No native imports, AI calls or release changes.
