# First-run feature guide

## 1. Scope / Trigger

Read when changing App startup/navigation, FeatureGuide, onboarding preferences or Electron launch/test fixtures. Navigation is renderer-only explanatory UI and uses the existing native Modal; no job schema, IPC or provider operation is required.

Guide copy follows the actual entries in [operation-workspace.md](./operation-workspace.md), including lower-left generation/style settings, video-toolbar export and explicit person-name recommendations/undo.

## 2. Signatures

```tsx
<FeatureGuide onClose={closeFeatureGuide} />
hasSeenFeatureGuide(): boolean;
markFeatureGuideSeen(): void;
```

Preference: `slice-man.onboarding.v1` with recognized value `seen`. Common-header help has accessible name 功能导航. Shell `data-onboarding-state` describes pending/open/settled real startup decisions for UI/test observation, not a test-only bypass.

## 3. Contracts

- Auto-open only after successful initialization, unseen preference and no conflicting dialog/editor/operation; defer without replacing user actions. Failed initialization must remain visible. StrictMode effect cleanup/re-run cannot consume or duplicate the decision.
- Missing/unrecognized/corrupt preference is unseen; read/write exceptions cannot crash. Close/Escape/finish marks seen; opening alone does not. In-memory dismissal prevents repeated auto-opening during the current renderer even if writes fail.
- Unconditional `?` replays from step one for empty/populated workspaces and collapsed sidebar, including during an active job. Use App's single-dialog union; native Modal supplies focus containment/Escape/restore. Step changes have accessible announcements and predictable focus.
- Six short Chinese steps explain preparation, import, preview/resizable proofreading, AI checking, bounded category-based all/range repair and export. Copy must match final loop labels/rules: inclusive threshold, finite cap, whole-cue expansion, original-only zero translation and text-review accuracy limits.
- Guide never imports, invokes providers, changes layout/settings/selection/drafts or cancels active work. Readable content/actions must fit 1440x960 and 1050x700.
- Unit fixtures explicitly declare returning-user state. Shared native launch helper dismisses only the named guide through real UI after a settled startup decision; dedicated first-run tests preserve it. Do not add production APP_E2E bypasses or race instantaneous visibility checks.

## 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Fresh user data / upgrade without preference | One automatic guide after successful load |
| Recognized seen value | No automatic replay; manual help works |
| Storage unavailable or quota error | No crash; dismissed guide stays dismissed in-memory |
| Another dialog during startup | Defer, never replace/stack dialogs |
| Startup fails | Error remains visible; manual help remains usable |
| Close/Escape/finish followed by restart | Seen persists when storage available |
| Help during active work | Progress continues, no cancel/provider side effects |

## 5. Good / Base / Bad Cases

- Good: fresh startup shows one guide; dismissal persists; `?` replays the same concise steps on an empty workspace.
- Base: active-job help is freely closable and restores focus without changing job state.
- Bad: guide starts a provider/import action, overlays an initialization error or is silently disabled in product E2E mode.

## 6. Tests Required

Preference missing/corrupt/recognized/read-write failure; genuine empty/saved first launch; all dismissal paths and same-user-data restart; replay/collapsed sidebar; StrictMode/slow-load/startup error/competing dialog; native Tab/Shift+Tab/Escape/focus restore; min/default geometry and active-operation noninterference. jsdom assertions alone do not establish native focus trapping.

## 7. Wrong vs Correct

Wrong: default all tests to seen without genuine first-run coverage, or close any arbitrary dialog in the launch helper.

Correct: explicit returning-user fixtures plus dedicated unseen tests; native helper waits for real onboarding state and closes only the feature guide via its accessible UI.
