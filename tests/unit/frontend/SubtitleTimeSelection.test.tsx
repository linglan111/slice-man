// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SubtitleTimeSelection } from '../../../src/renderer/src/components/SubtitleTimeSelection';
import type { Segment } from '../../../src/shared/contracts';

afterEach(cleanup);
function cue(id: string, startMs: number, endMs: number): Segment {
  return { id, startMs, endMs, sourceText: id, translatedText: '', translationStale: false };
}
function props(): ComponentProps<typeof SubtitleTimeSelection> {
  return { segments: [cue('left', 0, 1000), cue('middle', 1000, 2000), cue('right', 2000, 3000)], durationMs: 3000, visibleIds: new Set(['left', 'middle', 'right']), draft: { start: '1', end: '2' }, onChange: vi.fn(), onSelect: vi.fn(), isBusy: false, unavailable: false };
}

describe('time selection form', () => {
  it('uses half-open overlap, millisecond rounding and the current filter without modifying cues', () => {
    const input = props(); const snapshot = JSON.stringify(input.segments);
    const { container, rerender } = render(<SubtitleTimeSelection {...input} />);
    fireEvent.submit(container.querySelector('form') ?? container);
    expect(input.onSelect).toHaveBeenLastCalledWith(['middle']);
    rerender(<SubtitleTimeSelection {...input} draft={{ start: '0.9996', end: '2.0004' }} />);
    fireEvent.click(screen.getByRole('button', { name: '选择此范围' }));
    expect(input.onSelect).toHaveBeenLastCalledWith(['middle']);
    rerender(<SubtitleTimeSelection {...input} visibleIds={new Set(['right'])} />);
    expect(screen.getByRole('status').textContent).toContain('0 条');
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
    expect(JSON.stringify(input.segments)).toBe(snapshot);
  });

  it('recalculates from a replaced timeline while retaining the controlled draft', () => {
    const input = props(); const { rerender } = render(<SubtitleTimeSelection {...input} />);
    rerender(<SubtitleTimeSelection {...input} segments={[cue('replacement', 900, 1800)]} visibleIds={new Set(['replacement'])} />);
    fireEvent.click(screen.getByRole('button', { name: '选择此范围' }));
    expect(input.onSelect).toHaveBeenCalledExactlyOnceWith(['replacement']);
    expect((screen.getByLabelText('选择范围开始（秒）') as HTMLInputElement).value).toBe('1');
    fireEvent.change(screen.getByLabelText('选择范围结束（秒）'), { target: { value: '2.5' } });
    expect(input.onChange).toHaveBeenCalledExactlyOnceWith({ start: '1', end: '2.5' });
  });

  it.each(['busy', 'unavailable', 'invalid', 'empty'] as const)('guards direct form submission when %s', (reason) => {
    const input = props();
    const { container } = render(<SubtitleTimeSelection {...input} isBusy={reason === 'busy'} unavailable={reason === 'unavailable'} draft={reason === 'invalid' ? { start: '', end: '2' } : input.draft} visibleIds={reason === 'empty' ? new Set() : input.visibleIds} />);
    fireEvent.submit(container.querySelector('form') ?? container);
    expect(input.onSelect).not.toHaveBeenCalled();
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
    if (reason === 'busy') expect((screen.getByLabelText('选择范围开始（秒）') as HTMLInputElement).disabled).toBe(true);
    if (reason === 'invalid') expect(screen.getByRole('alert').textContent).toContain('请填写起止时间');
  });
});
