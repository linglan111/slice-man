// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SubtitleList } from '../../../src/renderer/src/components/SubtitleList';
import { savedJob } from './app-fixtures';

afterEach(cleanup);
describe('SubtitleList playback following', () => {
  it('keeps a replaced silent fragment visible for range repair and requires review before ignoring stale findings', () => {
    const job = savedJob();
    job.options.translationEnabled = false;
    job.reviewReport = { id: 'report', profileId: 'review', providerFingerprint: 'configuration', completedAt: 10, state: 'stale', reviewedSegmentIds: ['removed'], fingerprints: { removed: 'old' }, findings: [{ id: 'old-finding', segmentId: 'removed', startMs: 2000, endMs: 3000, category: 'source', reason: '旧片段疑似异常', status: 'recheck' }] };
    const onRepairRange = vi.fn(); const onSeek = vi.fn();
    render(<SubtitleList job={job} selectedIds={[]} activeIds={[]} isBusy={false} isEditing={false} editor={null} onAdd={vi.fn()} onRemove={vi.fn()} onSelect={vi.fn()} onEdit={vi.fn()} onSeek={onSeek} onRetranslate={vi.fn()} onReview={vi.fn()} onRepairRange={onRepairRange} />);
    fireEvent.change(screen.getByLabelText('可疑度筛选'), { target: { value: 'pending' } });
    expect(screen.queryByText('没有待检查字幕')).toBeNull();
    expect(screen.getByText('原片段需复查')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '定位播放' }));
    expect(onSeek).toHaveBeenCalledExactlyOnceWith(2000);
    fireEvent.click(screen.getByRole('button', { name: '重新识别原片段' }));
    expect(onRepairRange).toHaveBeenCalledExactlyOnceWith({ startMs: 2000, endMs: 3000 });
    expect((screen.getByRole('button', { name: '忽略' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('highlights overlap cues, clears gaps and confines following to its own scroller', () => {
    const job = savedJob(); const first = job.segments[0]; if (!first) throw new Error('Fixture cue absent'); job.segments.push({ ...first, id: 'other-cue' });
    const props = { job, selectedIds: [], activeIds: ['old-cue', 'other-cue'], isBusy: false, isEditing: false, editor: null, onAdd: vi.fn(), onRemove: vi.fn(), onSelect: vi.fn(), onEdit: vi.fn(), onSeek: vi.fn(), onRetranslate: vi.fn() };
    const { rerender } = render(<SubtitleList {...props} activeIds={[]} />);
    const list = screen.getByLabelText('可滚动字幕');
    const scroll = vi.fn(); list.scrollTo = scroll;
    vi.spyOn(list, 'getBoundingClientRect').mockReturnValue({ top: 0, bottom: 100 } as DOMRect);
    vi.spyOn(screen.getByTestId('segment-0'), 'getBoundingClientRect').mockReturnValue({ top: 200, bottom: 280 } as DOMRect);
    rerender(<SubtitleList {...props} />);
    expect(screen.getAllByRole('article').every((row) => row.getAttribute('aria-current') === 'true')).toBe(true);
    expect(scroll).toHaveBeenCalledWith({ top: 200, behavior: 'smooth' });
    rerender(<SubtitleList {...props} activeIds={[]} />);
    expect(screen.getAllByRole('article').every((row) => !row.hasAttribute('aria-current'))).toBe(true);
  });

  it('pauses for manual wheel/keyboard browsing and editing, and resumes explicitly', () => {
    const props = { job: savedJob(), selectedIds: [], activeIds: [], isBusy: false, isEditing: false, editor: null, onAdd: vi.fn(), onRemove: vi.fn(), onSelect: vi.fn(), onEdit: vi.fn(), onSeek: vi.fn(), onRetranslate: vi.fn() };
    const { rerender } = render(<SubtitleList {...props} />);
    const list = screen.getByLabelText('可滚动字幕'); const scroll = vi.fn(); list.scrollTo = scroll;
    vi.spyOn(list, 'getBoundingClientRect').mockReturnValue({ top: 0, bottom: 100 } as DOMRect);
    vi.spyOn(screen.getByTestId('segment-0'), 'getBoundingClientRect').mockReturnValue({ top: 200, bottom: 280 } as DOMRect);
    fireEvent.wheel(list); rerender(<SubtitleList {...props} activeIds={['old-cue']} />);
    expect(scroll).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('跟随播放')); expect(scroll).toHaveBeenCalledOnce();
    scroll.mockClear(); fireEvent.keyDown(list, { key: 'PageDown' });
    rerender(<SubtitleList {...props} activeIds={['old-cue']} />); expect(scroll).not.toHaveBeenCalled();
    rerender(<SubtitleList {...props} activeIds={['old-cue']} isEditing />);
    fireEvent.click(screen.getByLabelText('跟随播放')); expect(scroll).not.toHaveBeenCalled();
    rerender(<SubtitleList {...props} activeIds={['old-cue']} />); expect(scroll).toHaveBeenCalledOnce();
  });
});
