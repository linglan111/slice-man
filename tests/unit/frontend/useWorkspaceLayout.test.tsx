// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceLayout } from '../../../src/renderer/src/hooks/useWorkspaceLayout';

let viewportWidth = 1440;
let columnHeight = 600;
let current: ReturnType<typeof useWorkspaceLayout> | undefined;
const observed: { nodes: Set<Element>; disconnected: boolean }[] = [];
function layout(): ReturnType<typeof useWorkspaceLayout> {
  if (!current) throw new Error('Layout fixture missing');
  return current;
}
function Harness({ noJob = false, inline = false }: { noJob?: boolean; inline?: boolean }): React.JSX.Element {
  current = useWorkspaceLayout(false, noJob ? '' : 'fixture-job', inline, true);
  return <div ref={current.rootRef} className="test-root">{!noJob && <div ref={current.gridRef} className="test-grid"><div ref={current.leftRef} className="test-left"><section ref={current.previewRef} className="test-preview" style={{ padding: 0 }}><div className="fixed-child" style={{ margin: 0 }} /><div className="preview-media" /></section>{inline && <div className="workspace-operation-card" />}</div><div ref={current.rightRef} className="test-right"><section className="subtitle-panel" style={{ padding: 0 }}><div className="fixed-child" style={{ margin: 0 }} /><div className="subtitle-list" /></section><section ref={current.resultsRef} className="workspace-results" /></div></div>}</div>;
}
beforeEach(() => {
  viewportWidth = 1440; columnHeight = 600; current = undefined; observed.length = 0; localStorage.clear();
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) { return this.classList.contains('test-root') ? viewportWidth : 1000; });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => columnHeight);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) { return new DOMRect(0, 0, 300, this.classList.contains('fixed-child') ? 100 : this.classList.contains('dynamic-error') ? 50 : 30); });
  vi.stubGlobal('ResizeObserver', class {
    state = { nodes: new Set<Element>(), disconnected: false };
    constructor() { observed.push(this.state); }
    observe(node: Element): void { this.state.nodes.add(node); this.state.disconnected = false; }
    disconnect(): void { this.state.nodes.clear(); this.state.disconnected = true; }
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('workspace allocation measurements', () => {
  it('caps operation content only at the available viewport instead of allocating blank form height', () => {
    const view = render(<Harness inline />);
    expect((layout().style as Record<string, string>)['--operation-max-height']).toBe('378px');
    view.rerender(<Harness />);
    expect((layout().style as Record<string, string>)['--operation-max-height']).toBe('378px');
    expect('editor' in layout()).toBe(false);
  });
  it('observes dynamic preview errors and proofreading tools without overwriting saved dimensions', async () => {
    render(<Harness inline />);
    const preview = document.querySelector('.test-preview'); const proofreading = document.querySelector('.subtitle-panel');
    if (!preview || !proofreading) throw new Error('Workspace fixture missing');
    const error = document.createElement('p'); error.className = 'dynamic-error'; error.style.margin = '0';
    const filter = document.createElement('p'); filter.className = 'dynamic-error'; filter.style.margin = '0';
    await act(async () => { preview.appendChild(error); proofreading.appendChild(filter); });
    expect((layout().style as Record<string, string>)['--operation-max-height']).toBe('328px');
    expect(layout().results.minimum).toBe(227);
    expect(observed.some((state) => state.nodes.has(error))).toBe(true);
    expect(localStorage.getItem('slice-man.layout')).toBeNull();
    await act(async () => { error.remove(); filter.remove(); });
    expect(layout().results.minimum).toBe(177);
    expect(observed.every((state) => !state.nodes.has(error))).toBe(true);
  });
  it('ignores top-layer dialogs when reserving proofreading controls and preserves its split', async () => {
    render(<Harness />);
    const proofreading = document.querySelector('.subtitle-panel');
    if (!proofreading) throw new Error('Workspace fixture missing');
    act(() => layout().results.update(250, true));
    const saved = localStorage.getItem('slice-man.layout');
    const minimum = layout().results.minimum;
    const resultHeight = (layout().style as Record<string, string>)['--results-height'];
    const dialog = document.createElement('dialog');
    dialog.className = 'dynamic-error'; dialog.style.margin = '0'; dialog.open = true;
    await act(async () => { proofreading.appendChild(dialog); });
    expect(layout().results.minimum).toBe(minimum);
    expect(layout().results.value).toBeCloseTo(250);
    expect((layout().style as Record<string, string>)['--results-height']).toBe(resultHeight);
    expect(localStorage.getItem('slice-man.layout')).toBe(saved);
    await act(async () => { dialog.remove(); });
    expect(layout().results.minimum).toBe(minimum);
    expect(layout().results.value).toBeCloseTo(250);
  });
  it('persists the right split, cancels pointer changes, passively clamps and restores the saved proportion', () => {
    const view = render(<Harness />);
    expect(layout().results.value).toBe(472);
    act(() => layout().results.update(300, true));
    const saved = localStorage.getItem('slice-man.layout');
    expect(JSON.parse(saved ?? '{}').results).toBeCloseTo(1 - 300 / 590);
    act(() => layout().results.update(400, false));
    act(() => layout().results.cancel()); expect(layout().results.value).toBeCloseTo(300);
    columnHeight = 300; view.rerender(<Harness inline />);
    expect(layout().results.value).toBe(177);
    expect(localStorage.getItem('slice-man.layout')).toBe(saved);
    columnHeight = 600; view.rerender(<Harness />);
    expect(layout().results.value).toBeCloseTo(300);
    act(() => layout().reset()); expect(layout().results.value).toBe(472);
    expect(localStorage.getItem('slice-man.layout')).toBeNull();
  });
  it('measures and resets a fresh compact welcome sidebar without a job', () => {
    viewportWidth = 1050; const view = render(<Harness noJob />);
    expect(layout().sidebar.value).toBe(184);
    act(() => layout().sidebar.update(280, true)); expect(layout().sidebar.value).toBe(280);
    act(() => layout().reset()); expect(layout().sidebar.value).toBe(184);
    view.unmount(); expect(observed.every((state) => state.disconnected)).toBe(true);
  });
});
