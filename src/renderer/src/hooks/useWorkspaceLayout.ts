import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { clamp, DEFAULT_LAYOUT, LAYOUT_KEY, parseLayoutPreferences, type LayoutPreferences } from '../lib/layout-preferences';

type Measurements = { width: number; gridWidth: number; leftHeight: number; previewHeight: number; fixedHeight: number; secondaryHeader: number; videoMinimum: number };
type Allocation = { value: number; minimum: number; maximum: number; update: (value: number, commit: boolean) => void; cancel: () => void; position?: number };
export function useWorkspaceLayout(isSidebarCollapsed: boolean, jobId: string, hasInlineForm: boolean): {
  rootRef: RefObject<HTMLDivElement | null>; gridRef: RefObject<HTMLDivElement | null>; leftRef: RefObject<HTMLDivElement | null>; previewRef: RefObject<HTMLElement | null>;
  style: CSSProperties; sidebar: Allocation; columns: Allocation; secondary: Allocation; editor: Allocation; reset: () => void;
} {
  const [preferences, setPreferences] = useState(() => parseLayoutPreferences(localStorage.getItem(LAYOUT_KEY)));
  const preferenceRef = useRef(preferences);
  preferenceRef.current = preferences;
  const dragPreference = useRef<LayoutPreferences | null>(null);
  const rootRef = useRef<HTMLDivElement>(null); const gridRef = useRef<HTMLDivElement>(null); const leftRef = useRef<HTMLDivElement>(null); const previewRef = useRef<HTMLElement>(null);
  const [measurements, setMeasurements] = useState<Measurements>({ width: 1440, gridWidth: 1160, leftHeight: 720, previewHeight: 450, fixedHeight: 120, secondaryHeader: 54, videoMinimum: 160 });
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
      if (!(node instanceof HTMLElement) || node.matches('.video-stage, .preview-editor, .reprocessing-panel, .pane-divider')) continue;
      const style = getComputedStyle(node);
      fixedHeight += node.getBoundingClientRect().height + parseFloat(style.marginTop) + parseFloat(style.marginBottom);
    }
    const videoStage = preview.querySelector('.video-stage');
    const next = { width: root.clientWidth, gridWidth: grid.clientWidth, leftHeight: left.clientHeight, previewHeight: preview.clientHeight,
      fixedHeight, secondaryHeader: left.querySelector('.secondary-controls__toggle')?.getBoundingClientRect().height ?? 54,
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
    if (commit) { dragPreference.current = null; localStorage.setItem(LAYOUT_KEY, JSON.stringify(next)); }
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
  const previewMinimum = measurements.fixedHeight + measurements.videoMinimum + (hasInlineForm ? 85 + 16 : 0);
  const availableSecondary = measurements.leftHeight - previewMinimum - 10;
  const secondaryMinimum = Math.min(measurements.secondaryHeader + (hasInlineForm ? 32 : 64), Math.max(measurements.secondaryHeader, availableSecondary));
  const secondaryMaximum = Math.max(secondaryMinimum, availableSecondary);
  const secondaryHeight = clamp(preferences.secondary * measurements.leftHeight, secondaryMinimum, secondaryMaximum);
  const editorSpace = Math.max(measurements.videoMinimum + 85, measurements.previewHeight - measurements.fixedHeight - 16);
  const videoHeight = clamp(preferences.editor * editorSpace, measurements.videoMinimum, editorSpace - 85);
  return { rootRef, gridRef, leftRef, previewRef,
    style: { '--sidebar-width': `${sidebarValue}px`, '--left-width': `${leftWidth}px`, '--secondary-height': `${secondaryHeight}px`, '--inline-video-height': `${videoHeight}px` } as CSSProperties,
    sidebar: { value: sidebarValue, minimum: 160, maximum: sidebarMaximum, update: (value, commit) => update('sidebar', value, commit), cancel },
    columns: { value: leftWidth, minimum: leftMinimum, maximum: leftMaximum, position: leftWidth + gap / 2, update: (value, commit) => update('columns', value / columnSpace, commit), cancel },
    secondary: { value: measurements.leftHeight - secondaryHeight - 10, minimum: previewMinimum, maximum: measurements.leftHeight - secondaryMinimum - 10, update: (value, commit) => update('secondary', (measurements.leftHeight - value - 10) / measurements.leftHeight, commit), cancel },
    editor: { value: videoHeight, minimum: measurements.videoMinimum, maximum: editorSpace - 85, update: (value, commit) => update('editor', value / editorSpace, commit), cancel },
    reset: () => { dragPreference.current = null; setPreferences({ ...DEFAULT_LAYOUT }); preferenceRef.current = { ...DEFAULT_LAYOUT }; localStorage.removeItem(LAYOUT_KEY); },
  };
}
