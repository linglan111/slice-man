// @vitest-environment jsdom
import { useState, type ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReviewFilterMenu } from '../../../src/renderer/src/components/ReviewFilterMenu';
import type { ReviewFilter } from '../../../src/renderer/src/lib/review-presentation';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const choices = [
  { value: 'all' as const, label: '全部', count: 10 },
  { value: 'high' as const, label: '高', count: 3 },
  { value: 'medium' as const, label: '中', count: 4 },
];

function Harness(): ReactNode {
  const [filters, setFilters] = useState<ReviewFilter[]>(['all']);
  return <ReviewFilterMenu value={filters} choices={choices} onChange={setFilters} />;
}

describe('review filter portal interactions', () => {
  it('keeps all exclusive, combines grades, and returns to all after clearing the last grade', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '可疑度筛选' }));
    const group = screen.getByRole('group', { name: '可疑度筛选选项' });
    const all = within(group).getByRole('checkbox', { name: '全部（10）' }) as HTMLInputElement;
    const high = within(group).getByRole('checkbox', { name: '高（3）' }) as HTMLInputElement;
    const medium = within(group).getByRole('checkbox', { name: '中（4）' }) as HTMLInputElement;
    fireEvent.click(high); fireEvent.click(medium);
    expect(all.checked).toBe(false);
    expect(high.checked && medium.checked).toBe(true);
    fireEvent.click(all);
    expect(all.checked).toBe(true);
    expect(high.checked || medium.checked).toBe(false);
    fireEvent.click(high); fireEvent.click(high);
    expect(all.checked).toBe(true);
    expect(high.checked).toBe(false);
  });

  it('focuses the portal checkbox and restores the trigger on Escape without changing filters', () => {
    const onChange = vi.fn();
    const { container } = render(<ReviewFilterMenu value={['high']} choices={choices} onChange={onChange} />);
    const trigger = screen.getByRole('button', { name: '可疑度筛选' });
    trigger.focus(); fireEvent.click(trigger);
    const group = screen.getByRole('group', { name: '可疑度筛选选项' });
    expect(container.contains(group)).toBe(false);
    expect(document.activeElement).toBe(within(group).getByRole('checkbox', { name: '全部（10）' }));
    fireEvent.keyDown(document.activeElement ?? group, { key: 'Escape' });
    expect(screen.queryByRole('group')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(onChange).not.toHaveBeenCalled();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('tracks scrolling and resizing within the viewport without closing on inside clicks', () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: '可疑度筛选' });
    const bounds = vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({ left: 30, bottom: 60 } as DOMRect);
    fireEvent.click(trigger);
    const popup = screen.getByRole('group', { name: '可疑度筛选选项' });
    expect(popup.style.left).toBe('30px'); expect(popup.style.top).toBe('66px');
    fireEvent.pointerDown(within(popup).getByRole('checkbox', { name: '高（3）' }));
    expect(screen.getByRole('group')).toBe(popup);
    bounds.mockReturnValue({ left: window.innerWidth, bottom: window.innerHeight } as DOMRect);
    fireEvent.scroll(window);
    expect(parseFloat(popup.style.left)).toBeLessThanOrEqual(window.innerWidth - 248);
    expect(parseFloat(popup.style.top)).toBeLessThanOrEqual(window.innerHeight - 180);
    bounds.mockReturnValue({ left: 50, bottom: 90 } as DOMRect);
    fireEvent.resize(window);
    expect(popup.style.left).toBe('50px'); expect(popup.style.top).toBe('96px');
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('group')).toBeNull();
  });

  it('removes document and window event handlers on unmount', () => {
    const removeDocument = vi.spyOn(document, 'removeEventListener');
    const removeWindow = vi.spyOn(window, 'removeEventListener');
    const { unmount } = render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '可疑度筛选' }));
    unmount();
    expect(removeDocument).toHaveBeenCalledWith('pointerdown', expect.any(Function));
    expect(removeDocument).toHaveBeenCalledWith('focusin', expect.any(Function));
    expect(removeDocument).toHaveBeenCalledWith('keydown', expect.any(Function));
    expect(removeWindow).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(removeWindow).toHaveBeenCalledWith('scroll', expect.any(Function), true);
    expect(screen.queryByRole('group')).toBeNull();
  });

  it('dismisses when keyboard focus leaves, retaining the destination focus and its Escape handling', async () => {
    const user = userEvent.setup();
    render(<><Harness /><button type="button">打开其他面板</button></>);
    fireEvent.click(screen.getByRole('button', { name: '可疑度筛选' }));
    const popup = screen.getByRole('group', { name: '可疑度筛选选项' });
    expect(document.activeElement).toBe(within(popup).getByRole('checkbox', { name: '全部（10）' }));
    await user.tab();
    expect(document.activeElement).toBe(within(popup).getByRole('checkbox', { name: '高（3）' }));
    expect(screen.getByRole('group')).toBe(popup);
    await user.tab({ shift: true });
    await user.tab({ shift: true });
    const destination = screen.getByRole('button', { name: '打开其他面板' });
    expect(document.activeElement).toBe(destination);
    expect(screen.queryByRole('group')).toBeNull();
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    fireEvent(destination, escape);
    expect(escape.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(destination);
  });
});
