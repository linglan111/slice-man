// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PaneDivider } from '../../../src/renderer/src/components/PaneDivider';

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} });
  vi.stubGlobal('PointerEvent', class extends MouseEvent { pointerId = 1; });
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => true);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('pane divider interaction lifecycle', () => {
  const props = { label: 'Resize pane', orientation: 'vertical' as const, value: 200, minimum: 160, maximum: 300 };
  it('captures drag, clamps extreme motion and commits only on release', () => {
    const onChange = vi.fn(); const cancel = vi.fn(); render(<PaneDivider {...props} onChange={onChange} cancel={cancel} />);
    const divider = screen.getByRole('separator');
    fireEvent.pointerDown(divider, { button: 0, clientX: 200 });
    fireEvent.pointerMove(divider, { clientX: 1000 });
    expect(onChange).toHaveBeenLastCalledWith(300, false);
    expect(document.body.classList.contains('pane-dragging')).toBe(true);
    fireEvent.pointerUp(divider);
    expect(onChange).toHaveBeenLastCalledWith(300, true);
    expect(cancel).not.toHaveBeenCalled();
    expect(document.body.classList.contains('pane-dragging')).toBe(false);
  });
  it.each(['pointerCancel', 'lostPointerCapture', 'Escape', 'unmount'])('rolls back %s and clears cursor/selection state', (action) => {
    const onChange = vi.fn(); const cancel = vi.fn(); const view = render(<PaneDivider {...props} onChange={onChange} cancel={cancel} />);
    const divider = screen.getByRole('separator');
    fireEvent.pointerDown(divider, { button: 0, clientX: 200 }); fireEvent.pointerMove(divider, { clientX: 220 });
    if (action === 'unmount') view.unmount();
    else if (action === 'Escape') fireEvent.keyDown(divider, { key: 'Escape' });
    else if (action === 'pointerCancel') fireEvent.pointerCancel(divider);
    else fireEvent.lostPointerCapture(divider);
    expect(cancel).toHaveBeenCalledOnce();
    expect(onChange).not.toHaveBeenCalledWith(expect.anything(), true);
    expect(document.body.classList.contains('pane-dragging')).toBe(false);
  });
  it('exposes limits and supports axis-aware arrows, shift and Home/End', () => {
    const onChange = vi.fn(); render(<PaneDivider {...props} orientation="horizontal" onChange={onChange} cancel={vi.fn()} />);
    const divider = screen.getByRole('separator');
    expect(divider.getAttribute('aria-orientation')).toBe('horizontal');
    fireEvent.keyDown(divider, { key: 'ArrowUp', shiftKey: true }); expect(onChange).toHaveBeenLastCalledWith(160, true);
    fireEvent.keyDown(divider, { key: 'ArrowDown' }); expect(onChange).toHaveBeenLastCalledWith(210, true);
    fireEvent.keyDown(divider, { key: 'End' }); expect(onChange).toHaveBeenLastCalledWith(300, true);
    fireEvent.keyDown(divider, { key: 'Home' }); expect(onChange).toHaveBeenLastCalledWith(160, true);
  });
});
