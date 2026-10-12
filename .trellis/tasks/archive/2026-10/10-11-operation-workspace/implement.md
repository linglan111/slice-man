# Execution plan

Status: approved2026-10-11; implementation in progress.

1. Read curated frontend/shared contracts and inspect final original-loop/guide integration.
2. Own App.tsx, SubtitleList.tsx, layout CSS/useWorkspaceLayout and reusable operation/settings form integration. Coordinate review/name components without concurrent App edits.
3. Extract generation/style settings and export form content with one source of state/handlers. Add lower-left entries and explicit two-column settings dialogs.
4. Add one active toolbar panel and compact visible action footer. Reposition title/stages/status/results to reserve centre-bottom height; preserve cancel/alerts.
5. Integrate review setup/Standards and name panel after their contracts settle; move requested Add/Follow controls and refresh guide copy.
6. Native default/min geometry before broad fixture selector adaptation; assert actions without scrollTo and retain media-control safe area.
7. Test drag/keyboard/reset/restart/collapse and every retained processing workflow. Update docs/specs; lint/typecheck/unit/build, delegated final full native E2E.

Risks: measured-height feedback loops, shell overflow, subtitle overlay/native-controls collision, duplicate form state, accidentally executing actions on open. Keep schema/service behavior unchanged; rollback CSS/hook/form extraction coherently.
