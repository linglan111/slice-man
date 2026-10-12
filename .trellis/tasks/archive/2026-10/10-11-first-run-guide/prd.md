# First-run feature guide

## Goal

Help users quickly find import, configuration, proofreading, automatic repair and export through a short guide that can be reopened.

## Background

User explicitly added first-open navigation and a later `?` replay entry. Parent research `../10-11-repair-and-onboarding/research/first-run-guide.md` anchors the native Modal (`Modal.tsx:13`), common header (`App.tsx:194`), startup success/error distinction (`App.tsx:71`, `:84`), StrictMode (`main.tsx:11`) and isolated native E2E launch helper (`helpers.ts:312`).

## Requirements

- G1: Automatically open after first successful initialization when no other modal/action is active. Missing recognized seen preference means first-run, including upgrades without a guide preference. Failed initialization must remain visible.
- G2: Common-header `?` has accessible name 功能导航 and is available on empty/populated projects and with collapsed sidebar; manual replay always starts at step 1.
- G3: Six short Chinese steps cover engine/API preparation, import/generation, preview/resizable proofreading, AI checks, bounded category-based repair and styles/export. Explain inclusive grade selection, round cap, all/range reruns and approved effective-range boundary policy, original-only safeguards and AI accuracy limits.
- G4: Use existing native Modal with next/back/finish/close, keyboard containment, Escape, predictable announcements and focus restoration. All controls/readable content fit native minimum/default windows.
- G5: Persist seen only after close/Escape/finish in a dedicated UI preference; catch storage errors and suppress repeated auto-open within the current renderer. Guide never resets project/layout/drafts, invokes providers or interrupts active work.
- G6: Adapt legacy tests through explicit returning-user fixtures and actual guide UI dismissal in native helper; no production test-flag bypass. Dedicated first-run tests retain the real fresh-user guide.

## Acceptance criteria

- [x] AC-G1 (G1, G5): Empty and saved-project fresh user data auto-opens once; dismiss/complete persists across restart; corrupt or unavailable storage cannot crash or repeatedly nag the running renderer.
- [x] AC-G2 (G1, G2): Slow/failed startup and another dialog opened during initialization do not produce overlapping/replaced modals; help remains manually usable.
- [x] AC-G3 (G2–G4): Replay from both workspace states and collapsed sidebar starts at step 1; all steps, Escape, Tab/Shift+Tab and focus restoration work in actual Electron.
- [x] AC-G4 (G3–G5): Guide matches final loop labels/rules, preserves active jobs/selection/playback/settings and does not call import/AI/export APIs.
- [x] AC-G5 (G4, G6): 1440x960 and 1050x700 native geometry passes; full existing App/Electron regression tests still exercise real startup behaviour.

## Out of scope

Mandatory setup wizard, project-specific highlight anchors, automatic installation/import/generation, background repair, tutorial videos and localization redesign.

## Planning status

User approved the parent summary including six-step/dismiss-to-remember behavior on 2026-10-11. Implementation is complete and under independent full native regression; final guide copy will be refreshed only after approval/implementation of the later R9–R11 additions.

## Dependencies

Guide component/preferences can be implemented independently. Final repair-step copy depends on stable loop scope/control labels, including the user-approved whole-cue boundary expansion; coordinate shared App integration after loop UI edits settle.

## Final validation2026-10-12

Approved behavior implemented and independently reviewed. Global lint/typecheck/build passed; full unit/integration60files574pass; final native40total37pass/3explicitexternalgateskip/0fail. See parent evidence/final-added-e2e-review.md and final-unit.log. Implementation is not an AI accuracy guarantee. Task remains active pending required commit confirmation and bookkeeping; no release/version change.
