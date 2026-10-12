import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { clamp, DEFAULT_LAYOUT, LAYOUT_KEY, parseLayoutPreferences, type LayoutPreferences } from '../lib/layout-preferences';

type Measurements = { width: number; gridWidth: number; previewHeight: number; fixedHeight: number; videoMinimum: number };
type Allocation = { value: number; minimum: number; maximum: number; update: (value: number, commit: boolean) => void; cancel: () => void; position?: number };
export function useWorkspaceLayout(isSidebarCollapsed: boolean, jobId: string, hasInlineForm: boolean): {
  rootRef: RefObject<HTMLDivElement | null>; gridRef: RefObject<HTMLDivElement | null>; leftRef: RefObject<HTMLDivElement | null>; previewRef: RefObject<HTMLElement | null>;
  style: CSSProperties; sidebar: Allocation; columns: Allocation; editor: Allocation; reset: () => void;
} {
  const [preferences, setPreferences] = useState(() => { try { return parseLayoutPreferences(localStorage.getItem(LAYOUT_KEY)); } catch { return { ...DEFAULT_LAYOUT }; } });
  const preferenceRef = useRef(preferences);
  preferenceRef.current = preferences;
  const dragPreference = useRef<LayoutPreferences | null>(null);
  const rootRef = useRef<HTMLDivElement>(null); const gridRef = useRef<HTMLDivElement>(null); const leftRef = useRef<HTMLDivElement>(null); const previewRef = useRef<HTMLElement>(null);
  const [measurements, setMeasurements] = useState<Measurements>({ width: 1440, gridWidth: 1160, previewHeight: 450, fixedHeight: 120, videoMinimum: 160 });
  const measure = useCallback(() => {
    const root = rootRef.current; const grid = gridRef.current; const left = leftRef.current; const preview = previewRef.current;
    if (!root || !root.clientWidth) return;
    if (!grid || !left || !preview || !grid.clientWidth || !left.clientHeight) {
      setMeasurements((current) => current.width === root.clientWidth ? current : { ...current, width: root.clientWidth });
      return;
    }
    const previewStyle = getComputedStyle(preview);
    let fixedHeight = parseFloat(previewStyle.paddingTop) + parseFloat(previewStyle.paddingBottom) + 2;
    for (const node of [...preview.children]) {
      if (!(node instanceof HTMLElement) || node.matches('.video-stage, .preview-media, .preview-editor, .reprocessing-panel, .operation-panel, .pane-divider')) continue;
      const style = getComputedStyle(node);
      fixedHeight += node.getBoundingClientRect().height + parseFloat(style.marginTop) + parseFloat(style.marginBottom);
    }
    const videoStage = preview.querySelector('.video-stage');
    const next = { width: root.clientWidth, gridWidth: grid.clientWidth, previewHeight: preview.clientHeight,
      fixedHeight,
      videoMinimum: videoStage ? parseFloat(getComputedStyle(videoStage).minHeight) || 110 : 110 };
    setMeasurements((current) => Object.keys(next).every((key) => Math.abs(next[key as keyof Measurements] - current[key as keyof Measurements]) < .5) ? current : next);
  }, []);
  useLayoutEffect(() => {
    measure();
    const observer = new ResizeObserver(measure);
    function observeCurrentChildren(): void {
      observer.disconnect();
      for (const node of [rootRef.current, gridRef.current, leftRef.current, previewRef.current, ...(previewRef.current?.children ?? [])]) if (node) observer.observe(node);
      measure();
    }
    observeCurrentChildren();
    // Errors and reload actions can arrive without changing the job/form state.
    const mutationObserver = new MutationObserver(observeCurrentChildren);
    if (previewRef.current) mutationObserver.observe(previewRef.current, { childList: true });
    return () => { mutationObserver.disconnect(); observer.disconnect(); };
  }, [measure, jobId, hasInlineForm, isSidebarCollapsed]);
  function update(key: keyof LayoutPreferences, value: number, commit: boolean): void {
    if (!commit && !dragPreference.current) dragPreference.current = preferenceRef.current;
    const next = { ...preferenceRef.current, [key]: value };
    preferenceRef.current = next; setPreferences(next);
    if (commit) { dragPreference.current = null; try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(next)); } catch { /* Keep the changed layout for this session. */ } }
  }
  function cancel(): void {
    const previous = dragPreference.current;
    dragPreference.current = null;
    if (previous) { preferenceRef.current = previous; setPreferences(previous); }
  }
  const compact = measurements.width <= 1150;
  const gap = compact ? 10 : 14;
  const sidebarMaximum = Math.max(160, Math.min(300, measurements.width - (compact ? 28 : 44) - gap - 320 - 350));
  const sidebarValue = clamp(preferences.sidebar ?? (compact ? 184 : 216), 160, sidebarMaximum);
  const columnSpace = Math.max(1, measurements.gridWidth - gap);
  const leftMinimum = Math.min(320, columnSpace / 2); const leftMaximum = Math.max(leftMinimum, columnSpace - 350);
  const leftWidth = clamp(preferences.columns * columnSpace, leftMinimum, leftMaximum);
  // Reserve room for a compact two-column form, including all export choices
  // above its pinned footer, before allocating the remaining space to video.
  const formMinimum = hasInlineForm ? 320 : 85;
  const editorSpace = Math.max(measurements.videoMinimum + formMinimum, measurements.previewHeight - measurements.fixedHeight - 16);
  const videoHeight = clamp(preferences.editor * editorSpace, measurements.videoMinimum, editorSpace - formMinimum);
  return { rootRef, gridRef, leftRef, previewRef,
    style: { '--sidebar-width': `${sidebarValue}px`, '--left-width': `${leftWidth}px`, '--inline-video-height': `${videoHeight}px` } as CSSProperties,
    sidebar: { value: sidebarValue, minimum: 160, maximum: sidebarMaximum, update: (value, commit) => update('sidebar', value, commit), cancel },
    columns: { value: leftWidth, minimum: leftMinimum, maximum: leftMaximum, position: leftWidth + gap / 2, update: (value, commit) => update('columns', value / columnSpace, commit), cancel },
    editor: { value: videoHeight, minimum: measurements.videoMinimum, maximum: editorSpace - formMinimum, update: (value, commit) => update('editor', value / editorSpace, commit), cancel },
    reset: () => { dragPreference.current = null; setPreferences({ ...DEFAULT_LAYOUT }); preferenceRef.current = { ...DEFAULT_LAYOUT }; try { localStorage.removeItem(LAYOUT_KEY); } catch { /* Reset remains available without persistence. */ } },
  };
}
