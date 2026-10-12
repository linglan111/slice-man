# Research: First-run feature guide and persistent help replay

- Query: Find existing startup/dialog/preferences/test patterns and propose a safe, accessible first-open Chinese guide plus a persistent `?` replay button.
- Scope: internal
- Date: 2026-10-11 (Asia/Hong_Kong)
- Task: `.trellis/tasks/10-11-repair-and-onboarding`; planning child `.trellis/tasks/10-11-first-run-guide`.
- Authorization: task/planning approved; no product edits or task activation performed by this researcher.

## Findings

### Existing files and precise anchors

| File | Relevant implementation / implication |
| --- | --- |
| `src/renderer/src/App.tsx:26` | Single `Dialog` union for configuration, import and export; add a guide variant instead of creating a second overlapping modal manager. |
| `src/renderer/src/App.tsx:42` | Existing `dialog` state; guide should participate in this state. |
| `src/renderer/src/App.tsx:47` | Initial loading state; initial guide must not cover the loading/error screen immediately on mount. |
| `src/renderer/src/App.tsx:71` | Startup effect subscribes to progress and concurrently reads jobs/profiles/runtime. Cleanup guards late promises with `isMounted`. |
| `src/renderer/src/App.tsx:84` | Loading is cleared even when startup fails; `!isLoading` alone is not proof of successful initialization. |
| `src/renderer/src/App.tsx:194` | Common workspace header exists with empty and populated project states. |
| `src/renderer/src/App.tsx:195` | Common top action group already contains reset-layout and project-conditional export buttons: place the unconditional `?` here. |
| `src/renderer/src/App.tsx:199` | Loading / loaded project / welcome switch happens below common header. |
| `src/renderer/src/App.tsx:218` | Existing conditionally mounted dialog component slots. |
| `src/renderer/src/components/Modal.tsx:13` | Native HTML `dialog.showModal()`, titled accessible dialog, Escape cancel handler and previous-focus restoration. Reuse this component. |
| `src/renderer/src/main.tsx:11` | Renderer uses React `StrictMode`; startup guide effects must be idempotent through effect cleanup/re-run. |
| `src/renderer/src/lib/layout-preferences.ts:3` | Existing UI namespace `slice-man.layout`; parser validates malformed input and applies defaults. |
| `src/renderer/src/components/SecondaryControls.tsx:3` | Disclosure preference is renderer-local `slice-man.secondary-expanded`; no backend or domain schema necessary for another UI-only preference. |
| `src/renderer/src/styles/components.css:38` | Existing modal width 520px, viewport limits and internal scrolling with stable scrollbar gutter. |
| `src/renderer/src/styles/editor-layout.css:25` | Header has shrinking title and nonshrinking action group; keep help icon compact to preserve proofreading space. |
| `src/renderer/src/styles/editor-layout.css:103` | Small-window adaptations at <=1150px; include new help controls in minimum-size geometry checks. |
| `src/main/index.ts:72` | Default native window 1440x960; minimum 1050x700 at lines 74-75. Use native `BrowserWindow.setSize` for actual minimum-window E2E. |
| `src/main/env-setup.ts:3` | Test user data only applies to unpackaged `APP_E2E`; production has normal user data and developer app uses a separate `-dev` directory. |
| `src/renderer/src/components/JobSettings.tsx:18` | Original-language mode explicitly states recognition/repair/preview/export use source text. Guide must preserve that meaning. |
| `src/renderer/src/components/JobSettings.tsx:28` | Optional `AI 检查服务（可选）` configuration lives in expandable generation settings. |
| `src/renderer/src/components/SubtitleList.tsx:45` | AI checking requires a review provider and nonempty cues. |
| `src/renderer/src/components/SubtitleList.tsx:46` | Existing grade filter, batch grade selection and visible standard explanation; distinguish filter from the new inclusive repair threshold. |
| `src/renderer/src/components/SubtitleList.tsx:47` | Explicit caveat: context-based text review is not proof of audio recognition correctness; retain in guide. |
| `tests/unit/frontend/Modal.test.tsx:12` | Unit coverage for native dialog title, restoration and cancel behavior; jsdom polyfills dialog methods. Actual focus trap still needs Chromium E2E. |
| `tests/unit/frontend/app-fixtures.ts:20` | Common App API stub; currently does not establish guide preferences or polyfill dialogs. |
| `tests/unit/frontend/SecondaryControls.test.tsx:9` | Clears localStorage and renders App without native-dialog polyfill. New first-open behavior requires explicit fixture preparation here. |
| `tests/e2e/helpers.ts:312` | Shared Electron launch helper takes isolated user data, import/export queues and extra environment variables. |
| `tests/e2e/helpers.ts:337` | Waits for import button visibility and initial loading to disappear, then returns page. A visible import button behind a modal is not actionable, so guide handling belongs here. |
| `scripts/package-smoke.cjs:17` | Production smoke deliberately passes hostile E2E flags and verifies they are ignored. Do not add a production onboarding bypass for test flags. |
| `.github/workflows/release.yml:5` | Automatic publishing already restricted to `release`; development work must keep release policy unchanged. |

### Recommended guide UX

Use an explanatory staged dialog, not an overlay that scrolls/highlights project controls. Empty projects lack preview/grade/loop anchors, generation settings may be collapsed, and drag resizing changes geometry. A self-contained dialog works in all these cases and does not mutate the workspace to manufacture anchors.

- Common header `?` icon button, `aria-label="功能导航"` and `title="功能导航"`, always rendered in empty and populated states and independent of sidebar collapse. No need to extend `Icon.tsx` merely to render a literal `?`.
- Title `Slice Man 功能导航`, short step title/body and visible `第 N / 6 步` status. Show only one step at a time, `上一步`, `下一步`, `完成` on final step, and close/`稍后再看` available at every step.
- Opening manually always starts at step 1. Closing remembers seen status whether skipped, Escape or completed. This avoids repeatedly nagging users who already chose to close; replay remains explicit through `?`.
- Step changes must announce a new heading/status (`aria-live="polite"` in a concise region or purposeful heading focus) while preserving predictable keyboard movement. Native Modal already supplies containment; verify behavior when the previously focused next/previous control changes on the final step.
- Keep body readable with modal scroll bounds; footer actions must remain reachable at 1050x700. Prefer short paragraphs/parallel bullets, no horizontal overflow or text over decorative screenshots.
- No links/buttons in the guide automatically open settings/import dialogs, start downloads/recognition/review/repair/export, reset layout or change settings. The guide only explains where users go after closing it.

Suggested short Chinese sequence (final loop terminology must match the sibling's approved contract):

1. **准备识别与 AI 服务**: 左侧“本地引擎”安装模型；需要云端识别、翻译或 AI 检查时在“API 服务”添加配置。AI 检查可选。
2. **导入并生成字幕**: “导入视频”或“链接导入”；选原语言模式或启用翻译；在视频下方“生成、样式与导出”选择生成设置。
3. **预览与校对**: 左侧预览、右侧校对；点击字幕时间定位，编辑文字/时间；拖动分隔线调整宽高，展开/收起辅助设置或重置布局。
4. **检查可疑字幕**: 先配置 AI 检查服务再检查；可疑度有统一标准，可筛选、试听、手工修改或忽略。文字检查不能证明音频识别正确。
5. **自动循环修复**: 选择最低可疑度（例如“中及以上”）及最大轮数；按问题类型处理：原文/时间重新识别、译文仅重译；原语言模式不调用翻译；每轮复查，满足停止条件或达到上限结束，支持取消。循环不保证所有疑点消失，应核对停止说明和剩余问题。
6. **样式与导出**: 展开视频下方辅助区选择样式；顶部导出字幕文件或作品；左侧导出设置维护默认参数与保存位置。

### Preference and initialization contract

- Suggested dedicated key `slice-man.onboarding-seen`, or a versioned value `1` under `slice-man.onboarding`; use one exported constant/helper module for reads/writes and tests. This is UI state, not a Job/options field, database migration or IPC API.
- Missing/unrecognized/corrupt value means unseen; exact recognized seen value suppresses automatic replay. Catch storage read/write errors so disabled/quota-limited storage cannot crash the app. In-memory seen state must still suppress repeated opening within the running renderer if persistence fails.
- Explicit user dismissal/completion persists seen; automatic mount alone must not mark seen. A crash/close before dismissal can reasonably show it next launch.
- First auto-open after initial successful load and only when there is no other modal/editor/confirmation and no operation in progress. If user opens an action while startup is pending, do not replace that dialog. Deferring until it closes is safe; completion of a background job must never reopen a previously dismissed guide.
- Guard the once-per-renderer decision with stable state/ref and check current seen state; do not set a single ref in the first StrictMode setup that prevents the second setup from committing a usable modal. Store-based lazy initialization plus a single guide state transition is a suitable pattern.
- Help replay must work even if initialization failed, provided the common shell rendered, and must not write to the jobs/runtime/profile state. Unlike auto-open, manual replay is allowed during active jobs; native modal must remain freely closable and progress subscriptions continue.
- Closing/finishing the guide must not reset partial repair drafts, selection, playback time, layout or current job. Integrate with the existing modal union so nested modal stacking cannot occur.
- Electron renderer localStorage is naturally under the selected session/user-data storage; packaged file renderer and developer localhost renderer may have different origins. Test actual packaged/restart persistence if claiming it, rather than assuming development storage migrates to production.

### Affected implementation files

Expected new renderer `components/FeatureGuide.tsx` (or `OnboardingGuide.tsx`) and `lib/onboarding-preferences.ts`; integration in `App.tsx`; scoped guide rules in `styles/components.css` or a separate imported guide stylesheet if size warrants it. No backend/preload/contracts modification needed for onboarding.

Tests: new preference parsing/storage and guide/App tests, `tests/unit/frontend/app-fixtures.ts` and App-rendering suites as required for explicit returning-user setup; `tests/e2e/helpers.ts`; new `tests/e2e/onboarding.spec.ts`. Product code should never depend on test-only skip flags.

### Test isolation without hiding genuine first-run coverage

Recommended Electron helper extension: an optional fifth `launchApp` options argument such as `{ preserveGuide?: boolean }`, default false. After successful ready wait, handle an automatically displayed feature guide by its actual accessible close button and wait until it disappears; this exercises the genuine UI and writes the real seen preference. Dedicated first-run tests pass `preserveGuide: true` and observe the original modal. Existing fourth `extraEnv` calls stay compatible.

Do not blindly click arbitrary `关闭对话框` if another modal is open. Scope any dismissal to the guide's exact accessible dialog name. Helper implementation should wait for the settled guide decision after readiness (deterministic page locator/state contract), avoiding an instantaneous `isVisible()` check racing the post-load auto-open effect. Do not add a broad timeout to every returning-user launch; render guide decision together with load success or expose a UI readiness condition for the helper.

Recommended unit setup: an explicit `primeGuideSeen()` or optional `{ onboardingSeen: true }` test fixture option for legacy App tests. A new guide test must use the genuine empty storage/default path and control the opt-out. Avoid silently making all calls to `stubApi()` returning-user by default unless its options name that behavior; such a default could accidentally suppress future onboarding regression tests. Standalone components should keep normal empty storage tests.

### Required validation matrix

| Area | Meaningful checks |
| --- | --- |
| Preference | Missing/corrupt/unrecognized/recognized seen values; exceptions on read/write; unrelated layout keys unchanged. |
| First empty launch | Fresh isolated user data auto-opens after ready; no import/API/job action invoked; all steps usable without a project. |
| First saved-project launch | Existing persisted job plus unseen guide still displays; no absent anchor assumption; selection/content/options remain unchanged. |
| Dismiss/restart | Close and Escape both record seen; same user data restart has no automatic guide; completed final step also persists. |
| Replay | `?` opens from welcome and saved job, with sidebar expanded and collapsed; replay always starts at first step; repeat reopen works. |
| Keyboard | Native initial focus, Tab/Shift+Tab contained, step announcement, next/back order, Escape closes, focus returns to help trigger. Unit tests do not establish Chromium focus-trap proof. |
| Geometry | Default 1440x960 and actual minimum 1050x700; header help and export actions visible; guide/footer reachable; no horizontal scrollbar or spill outside viewport; right proofreading controls still accessible after close. |
| Startup races | StrictMode; slow load; failed load; other dialog opened before initialization completes; no modal replacement or double automatic guide. |
| Active jobs | Manual help while deterministic mocked long-running review/repair continues: no cancel requests, no extra provider requests, progress finishes normally, freely closing guide preserves busy/cancel/status UI. |
| Content | Inclusive threshold example, max loops, problem-based routing, original-language safeguard, optional AI accuracy limit, resize and export descriptions match sibling implementation. |
| Existing regressions | Legacy launch helper adapts through normal UI close; App suites explicit seen fixture; run lint/typecheck/unit/Electron regressions. Production smoke continues to ignore hostile APP_E2E flags. |

## Related Specs

- `.trellis/workflow.md`: planning-only research now, review gate before task activation/product edits.
- `.trellis/spec/frontend/index.md`: required frontend safety/context documents.
- `.trellis/spec/frontend/components.md`: semantic buttons, focus management and stable scroll gutters.
- `.trellis/spec/frontend/state-management.md`: UI-only preferences in localStorage, graceful missing/corrupt defaults.
- `.trellis/spec/frontend/css-design.md`: scoped styles/import order, no unnecessary new dependency.
- `.trellis/spec/frontend/electron-browser-api-restrictions.md`: no prompt/alert/confirm; custom React/native HTML dialog is supported by existing code.
- `.trellis/spec/frontend/react-pitfalls.md`: correct effect and initial-load handling; StrictMode cleanup matters.
- `.trellis/spec/shared/native-runtime-testing.md`: native Electron tests, isolated user data, production ignores dev/E2E flags, accurate claims about what tests prove.

## External References

None needed for this internal architecture research; no new third-party package or unstable external API is recommended. Existing `Modal` provides the supported native Chromium dialog abstraction.

## Caveats / Not Found

- No existing onboarding/first-run flag or global unit setup was found. Do not infer it from installed runtime/models or saved projects: users may have used Slice Man before the guide feature ships.
- Users upgrading an existing installation with no guide key will see it once. This is the practical initial rollout default; suppressing it for previously existing jobs would deny the added guidance to returning users and is not requested.
- Exact new loop button labels, maximum bound/default and stopping semantics belong to the sibling loop design. Copy must be finalized against that design, not invented independently.
- `App.isLoading` clears on initialization failure; naïvely using it as the sole auto-open predicate hides actionable startup errors.
- Native HTML dialog focus behavior cannot be fully proven by existing jsdom shims. Genuine Electron E2E is necessary.
- No remaining user intent question is necessary for the guide research; six short steps and seen-on-dismiss behavior are proposed routine defaults for final combined planning review.
