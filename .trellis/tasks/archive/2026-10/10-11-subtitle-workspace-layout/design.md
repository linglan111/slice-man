# Subtitle Workspace Layout Design

## Structure and Boundaries

The viewport shell remains fixed. The workspace grid has two flexible columns: left preview with secondary controls beneath it, right SubtitleList consuming the workspace height. Use explicit minimum sizes and flexible tracks appropriate for the native minimum window instead of a fixed 286px secondary sidebar.

Move the existing JobSettings, generation controls/status, StylePanel and outputs into a labeled collapsible region beneath preview. Prefer native accessible disclosure semantics or a button with aria-expanded/aria-controls; keep callbacks and component state/data contracts intact. Initial state is expanded for an ungenerated project and collapsed for existing subtitles unless a stored preference exists. Do not unexpectedly toggle during processing. Remember the preference independently of sidebar collapse.

## Scroll and Sizing Ownership

- Document/shell: fixed viewport, no global scroll.
- Right panel: fixed heading/toolbars, one flexible cue scroller. Toolbars wrap when necessary without clipping or making the list disappear.
- Left panel: usable video frame, stable preview actions, bounded form and secondary-content scrolling. Expanded settings cannot consume the right panel's space. Inline edit and repair actions must be reachable; remove conflicting flex shrink/min-height rules and unnecessary nested scrolling.
- Consolidate active workspace overrides rather than layering another competing stylesheet. Audit earlier workspace/component rules and later review-grade overrides.

## Contracts and Compatibility

No main/preload/database changes are expected. Preserve subtitle timeline millisecond semantics, revision protection, mode-specific visibility, provider selection, cancellation and export behavior. Disclosure state is local UI preference only and does not change persisted Job data. Retain existing aria names unless deliberately updating dependent tests.

The subsequent exact-name correction changes only the BrowserWindow title in main, renderer HTML title and workspace eyebrow to `Slice Man`. It introduces no IPC, provider or database behavior changes. Verify actual native/document titles and the visible default-width brand label in Electron.

## User-Adjustable Pane Dimensions

Provide visible narrow divider handles for expanded navigation/main, preview/proofreading columns, preview/secondary controls when expanded, and preview/inline editor or repair panel when present. The user explicitly chose resizing rather than reordering; interactive content is never a pane drag target.

Use a renderer-owned layout preference hook/model, CSS custom properties for dimensions, pointer capture for drags, and accessible role=separator with orientation/value information and arrow/Home/End keyboard behavior. An explicit reset restores the default allocation. Read stored values defensively and persist committed user adjustments, independently of Job data and disclosure preferences.

Measure actual parent bounds and clamp every allocation against usable opposite-pane minima. Recompute effective dimensions when the window resizes, banners appear or edit/disclosure states change. Store ratios for flexible allocations and bounded navigation pixels, so screen changes do not strand hidden controls. Drag/cancel/unmount cleanup releases pointer state and body cursor/selection styling. Navigation dragging is absent while collapsed; a closed secondary region does not retain an active horizontal divider. Editing may temporarily constrain effective allocation without destroying the user's saved normal preference.

The right panel remains independent of vertical left-column adjustments. The original screenshot defects must not recur at extreme drag limits: assert usable inner list/editor height and preview native controls as well as overall viewport containment.

Independent review refinements: derive the active video floor from the actual CSS contract (normal compact 130px, normal wider 160px, inline 110px); update measured fixed content when playback errors/reload controls are inserted. The preview has one visible operation area. Opening scoped repair temporarily hides, but keeps mounted, an existing preview editor so its exact unsaved draft returns when repair closes. Explicit preview edit/add returns to editor mode; an editor in the right list can coexist with left-side repair. Measure navigation width and expose reset even before a project exists. Native regression must assert preview actions against their clipping ancestor and actual hit targets, including extreme divider positions.

## Validation and Rollback

Use real Electron BrowserWindow resizing for layout assertions, actual media fixtures for preview/encoding, and deterministic loopback provider responses for regression. Add geometry and control reachability assertions rather than relying on screenshots alone. Evidence goes to this task's evidence directory. Keep real-provider and optional GPU gates explicit.

The rollback boundary is renderer layout/disclosure styling plus associated tests; existing user-data format remains compatible. Preserve the preexisting uncommitted Trellis/tooling files and avoid staging them with task changes.
