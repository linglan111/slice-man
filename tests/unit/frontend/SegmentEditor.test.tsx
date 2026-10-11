// @vitest-environment jsdom
import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SegmentEditor } from '../../../src/renderer/src/components/SegmentEditor';
import type { Segment } from '../../../src/shared/contracts';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function (): void { this.open = true; };
  HTMLDialogElement.prototype.close = function (): void { this.open = false; };
});
afterEach(cleanup);
const SEGMENT: Segment = { id: 'one', startMs: 100, endMs: 2000, sourceText: 'Original speech', translatedText: '原始译文', translationStale: false };

describe('SegmentEditor observable correction behavior', () => {
  it('rejects out-of-range input without saving', async () => {
    const onSave = vi.fn();
    render(<SegmentEditor segment={SEGMENT} durationMs={5000} onSave={onSave} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('结束时间（秒）'), { target: { value: '5.001' } });
    fireEvent.click(screen.getByRole('button', { name: '保存字幕' }));
    expect(screen.getByRole('alert').textContent).toContain('视频时长');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('saves corrections with exact timing and stable segment identity', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<SegmentEditor segment={SEGMENT} durationMs={5000} onSave={onSave} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText('开始时间（秒）'), { target: { value: '0.123' } });
    fireEvent.change(screen.getByLabelText('译文'), { target: { value: '手工校对译文' } });
    fireEvent.click(screen.getByRole('button', { name: '保存字幕' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onSave).toHaveBeenCalledWith({ ...SEGMENT, startMs: 123, translatedText: '手工校对译文' });
  });

  it('preserves user drafts after a recoverable revision failure', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('字幕已更新，请重新打开校对面板。'));
    const onClose = vi.fn();
    render(<SegmentEditor segment={SEGMENT} durationMs={5000} onSave={onSave} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText('原文'), { target: { value: 'Corrected original' } });
    fireEvent.click(screen.getByRole('button', { name: '保存字幕' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('重新打开'));
    expect((screen.getByLabelText('原文') as HTMLTextAreaElement).value).toBe('Corrected original');
    expect(onClose).not.toHaveBeenCalled();
  });
});
