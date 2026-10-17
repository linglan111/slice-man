import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { clamp, DEFAULT_LAYOUT, LAYOUT_KEY, parseLayoutPreferences, type LayoutPreferences } from '../lib/layout-preferences';

type Measurements = { width: number; gridWidth: number; leftHeight: number; fixedHeight: number; rightHeight: number; proofreadingFixed: number; operationContentHeight: number };
type Allocation = { value: number; minimum: number; maximum: number; update: (value: number, commit: boolean) => void; cancel: () => void; position?: number };
function pixels(value: string): number { return parseFloat(value) || 0; }
function outerHeight(node: HTMLElement): number {
  const style = getComputedStyle(node);
  return node.getBoundingClientRect().height + pixels(style.marginTop) + pixels(style.marginBottom);
}
export function useWorkspaceLayout(isSidebarCollapsed: boolean, jobId: string, operationKey: string | null, hasResults = false): {
  rootRef: RefObject<HTMLDivElement | null>; gridRef: RefObject<HTMLDivElement | null>; leftRef: RefObject<HTMLDivElement | null>; previewRef: RefObject<HTMLElement | null>; rightRef: RefObject<HTMLDivElement | null>; resultsRef: RefObject<HTMLElement | null>;
  operationRef: RefObject<HTMLDivElement | null>; operationContentRef: RefObject<HTMLDivElement | null>;
  style: CSSProperties; sidebar: Allocation; columns: Allocation; operation: Allocation; results: Allocation; reset: () => void;
} {
  const [preferences, setPreferences] = useState(() => { try { return parseLayoutPreferences(localStorage.getItem(LAYOUT_KEY)); } catch { return { ...DEFAULT_LAYOUT }; } });
  const preferenceRef = useRef(preferences);
  preferenceRef.current = preferences;
  const dragPreference = useRef<LayoutPreferences | null>(null);
  const rootRef = useRef<HTMLDivElement>(null); const gridRef = useRef<HTMLDivElement>(null); const leftRef = useRef<HTMLDivElement>(null); const previewRef = useRef<HTMLElement>(null);
  const rightRef = useRef<HTMLDivElement>(null); const resultsRef = useRef<HTMLElement>(null);
  const operationRef = useRef<HTMLDivElement>(null); const operationContentRef = useRef<HTMLDivElement>(null);
  const [manualOperationHeight, setManualOperationHeight] = useState<number | null>(null);
  const operationDrag = useRef<{ height: number | null } | null>(null);
  useLayoutEffect(() => { setManualOperationHeight(null); operationDrag.current = null; }, [jobId, operationKey]);
  const [measurements, setMeasurements] = useState<Measurements>({ width: 1440, gridWidth: 1160, leftHeight: 700, fixedHeight: 180, rightHeight: 700, proofreadingFixed: 150, operationContentHeight: 85 });
  const measure = useCallback(() => {
    const root = rootRef.current; const grid = gridRef.current; const left = leftRef.current; const preview = previewRef.current; const right = rightRef.current;
    if (!root || !root.clientWidth) return;
    if (!grid || !left || !preview || !grid.clientWidth || !left.clientHeight) {
      setMeasurements((current) => current.width === root.clientWidth ? current : { ...current, width: root.clientWidth });
      return;
    }
    const previewStyle = getComputedStyle(preview);
    let fixedHeight = pixels(previewStyle.paddingTop) + pixels(previewStyle.paddingBottom) + 2;
    for (const node of [...preview.children]) {
      if (!(node instanceof HTMLElement) || node.matches('.video-stage, .preview-media')) continue;
      fixedHeight += outerHeight(node);
    }
    const proofreading = right?.querySelector('.subtitle-panel');
    const proofreadingStyle = proofreading ? getComputedStyle(proofreading) : null;
    let proofreadingFixed = proofreadingStyle ? pixels(proofreadingStyle.paddingTop) + pixels(proofreadingStyle.paddingBottom) + 2 : 150;
    for (const node of [...(proofreading?.children ?? [])]) {
      // Native dialogs render in the top layer and never consume flex space.
      if (node instanceof HTMLElement && !node.matches('.subtitle-list, dialog')) proofreadingFixed += outerHeight(node);
    }
    const operation = operationRef.current; const operationStyle = operation ? getComputedStyle(operation) : null;
    const operationContentHeight = (operationContentRef.current?.getBoundingClientRect().height ?? 0) + (operationStyle ? pixels(operationStyle.paddingTop) + pixels(operationStyle.paddingBottom) + pixels(operationStyle.borderTopWidth) + pixels(operationStyle.borderBottomWidth) : 0);
    const next = { width: root.clientWidth, gridWidth: grid.clientWidth, leftHeight: left.clientHeight, fixedHeight, rightHeight: right?.clientHeight || left.clientHeight, proofreadingFixed, operationContentHeight };
    setMeasurements((current) => Object.keys(next).every((key) => Math.abs(next[key as keyof Measurements] - current[key as keyof Measurements]) < .5) ? current : next);
  }, []);
  useLayoutEffect(() => {
    const observer = new ResizeObserver(measure);
    function observeCurrentChildren(): void {
      observer.disconnect();
      const nodes = [rootRef.current, gridRef.current, leftRef.current, previewRef.current, rightRef.current, resultsRef.current, operationRef.current, operationContentRef.current, ...(previewRef.current?.children ?? []), ...(rightRef.current?.querySelector('.subtitle-panel')?.children ?? [])];
      for (const node of nodes) if (node) observer.observe(node);
      measure();
    }
    observeCurrentChildren();
    // Dynamic errors, filter tools and row editors can change available space.
    const mutationObserver = new MutationObserver(observeCurrentChildren);
    for (const node of [leftRef.current, rightRef.current]) if (node) mutationObserver.observe(node, { childList: true, subtree: true, characterData: true });
    return () => { mutationObserver.disconnect(); observer.disconnect(); };
  }, [measure, jobId, operationKey, hasResults, isSidebarCollapsed]);
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
  const operationGap = compact ? 8 : 10;
  // Auto-fit each operation independently. A manual allocation survives content
  // measurements until navigation; neither mode can consume the video floor.
  const operationMaximum = Math.max(0, measurements.leftHeight - measurements.fixedHeight - 110 - operationGap);
  const operationMinimum = Math.min(85, operationMaximum);
  const operationAutoMaximum = Math.min(operationMaximum, measurements.leftHeight * .45);
  const operationHeight = clamp(manualOperationHeight ?? measurements.operationContentHeight, operationMinimum, manualOperationHeight === null ? operationAutoMaximum : operationMaximum);
  const previewHeight = measurements.leftHeight - operationGap - operationHeight;
  const resultsSpace = Math.max(1, measurements.rightHeight - 10);
  const proofreadingMinimum = Math.min(resultsSpace - 64, measurements.proofreadingFixed + 75);
  const proofreadingMaximum = Math.max(proofreadingMinimum, resultsSpace - 64);
  const proofreadingHeight = clamp((1 - preferences.results) * resultsSpace, proofreadingMinimum, proofreadingMaximum);
  return { rootRef, gridRef, leftRef, previewRef, rightRef, resultsRef, operationRef, operationContentRef,
    style: { '--sidebar-width': `${sidebarValue}px`, '--left-width': `${leftWidth}px`, '--operation-height': `${operationHeight}px`, '--operation-max-height': `${operationMaximum}px`, '--results-height': `${resultsSpace - proofreadingHeight}px` } as CSSProperties,
    sidebar: { value: sidebarValue, minimum: 160, maximum: sidebarMaximum, update: (value, commit) => update('sidebar', value, commit), cancel },
    columns: { value: leftWidth, minimum: leftMinimum, maximum: leftMaximum, position: leftWidth + gap / 2, update: (value, commit) => update('columns', value / columnSpace, commit), cancel },
    operation: { value: previewHeight, minimum: measurements.leftHeight - operationGap - operationMaximum, maximum: measurements.leftHeight - operationGap - operationMinimum, position: previewHeight + operationGap / 2, update: (value, commit) => {
      if (!commit && !operationDrag.current) operationDrag.current = { height: manualOperationHeight };
      setManualOperationHeight(clamp(measurements.leftHeight - operationGap - value, operationMinimum, operationMaximum));
      if (commit) operationDrag.current = null;
    }, cancel: () => { const previous = operationDrag.current; operationDrag.current = null; if (previous) setManualOperationHeight(previous.height); } },
    results: { value: proofreadingHeight, minimum: proofreadingMinimum, maximum: proofreadingMaximum, update: (value, commit) => update('results', 1 - value / resultsSpace, commit), cancel },
    reset: () => { operationDrag.current = null; setManualOperationHeight(null); dragPreference.current = null; setPreferences({ ...DEFAULT_LAYOUT }); preferenceRef.current = { ...DEFAULT_LAYOUT }; try { localStorage.removeItem(LAYOUT_KEY); } catch { /* Reset remains available without persistence. */ } },
  };
}
