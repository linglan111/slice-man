// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceLayout } from '../../../src/renderer/src/hooks/useWorkspaceLayout';

let viewportWidth = 1440;
let current: ReturnType<typeof useWorkspaceLayout> | undefined;
const observed: { nodes: Set<Element>; disconnected: boolean }[] = [];
function layout(): ReturnType<typeof useWorkspaceLayout> {
  if (!current) throw new Error('Layout fixture missing');
  return current;
}
function Harness({ noJob = false, inline = false }: { noJob?: boolean; inline?: boolean }): React.JSX.Element {
  current = useWorkspaceLayout(false, noJob ? '' : 'fixture-job', inline);
  return <div ref={current.rootRef} className="test-root">{!noJob && <div ref={current.gridRef} className="test-grid"><div ref={current.leftRef} className="test-left"><section ref={current.previewRef} className="test-preview" style={{ padding: 0 }}><div className="fixed-child" style={{ margin: 0 }} /><div className="video-stage" style={{ minHeight: inline ? 110 : 160 }} /></section></div></div>}</div>;
}
beforeEach(() => {
  viewportWidth = 1440; current = undefined; observed.length = 0; localStorage.clear();
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) { return this.classList.contains('test-root') ? viewportWidth : 1000; });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.classList.contains('test-left') ? 600 : 400; });
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
  it('uses the actual CSS video floor in both normal and inline budgets', () => {
    const view = render(<Harness />);
    expect(layout().secondary.minimum).toBe(262); // 100px heading + 2px border + actual 160px video.
    view.rerender(<Harness inline />);
    expect(layout().secondary.minimum).toBe(313); // The one visible inline region adds 85px + 16px gutter.
    expect(layout().editor.minimum).toBe(110);
  });
  it('observes new fixed error actions and removes their budget when cleared', async () => {
    const view = render(<Harness />); const preview = document.querySelector('.test-preview');
    if (!preview) throw new Error('Preview fixture missing');
    const error = document.createElement('p'); error.className = 'dynamic-error'; error.style.margin = '0';
    await act(async () => { preview.appendChild(error); });
    expect(layout().secondary.minimum).toBe(312);
    expect(observed.some((state) => state.nodes.has(error))).toBe(true);
    await act(async () => { error.remove(); });
    expect(layout().secondary.minimum).toBe(262);
    expect(observed.every((state) => !state.nodes.has(error))).toBe(true);
    view.unmount(); expect(observed.every((state) => state.disconnected)).toBe(true);
  });
  it('measures a fresh compact welcome shell and resets its resized sidebar without a job', () => {
    viewportWidth = 1050; render(<Harness noJob />);
    expect(layout().sidebar.value).toBe(184);
    act(() => layout().sidebar.update(280, true)); expect(layout().sidebar.value).toBe(280);
    act(() => layout().reset()); expect(layout().sidebar.value).toBe(184);
    expect(localStorage.getItem('slice-man.layout')).toBeNull();
  });
});
