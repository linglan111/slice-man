// @vitest-environment jsdom
import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RecognitionResetDialog } from '../../../src/renderer/src/components/RecognitionResetDialog';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function (): void { this.open = true; };
  HTMLDialogElement.prototype.close = function (): void { this.open = false; };
});
afterEach(cleanup);

describe('explicit recognition replacement confirmation', () => {
  it('explains content replacement, retained files and no automatic translation before confirmation', () => {
    const onConfirm = vi.fn();
    render(<RecognitionResetDialog recognition="local" subtitleCount={433} onClose={vi.fn()} onConfirm={onConfirm} />);
    const dialog = screen.getByRole('dialog', { name: '重新识别原片' });
    expect(dialog.textContent).toContain('433 条字幕的原文、译文和手工校对');
    expect(dialog.textContent).toContain('已有导出文件会保留');
    expect(dialog.textContent).toContain('不会自动翻译');
    expect(dialog.textContent).toContain('取消或识别失败');
    expect(dialog.textContent).toContain('不会上传原片音频');
    expect(dialog.textContent).not.toContain('服务商可能收取费用');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('warns about renewed cloud audio upload and possible cost', () => {
    render(<RecognitionResetDialog recognition="cloud" subtitleCount={2} onClose={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByRole('dialog').textContent).toContain('重新上传原片音频');
    expect(screen.getByRole('dialog').textContent).toContain('服务商可能收取费用');
  });

  it('only starts replacement after the explicit confirm action', () => {
    const onConfirm = vi.fn(); const onClose = vi.fn();
    render(<RecognitionResetDialog recognition="cloud" subtitleCount={2} onClose={onClose} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: '保留现有字幕' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认重新识别' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('only explains keyword reset when the current style has per-cue emphasis', () => {
    const props = { recognition: 'local' as const, subtitleCount: 2, onClose: vi.fn(), onConfirm: vi.fn() };
    const { rerender } = render(<RecognitionResetDialog {...props} />);
    expect(screen.queryByText('逐句关键词强调将清除，整体样式保留。')).toBeNull();
    rerender(<RecognitionResetDialog {...props} hasEmphasis />);
    expect(screen.getByText('逐句关键词强调将清除，整体样式保留。')).toBeTruthy();
  });

  it('disables confirmation and dismissal while another stage is busy', () => {
    const onConfirm = vi.fn(); const onClose = vi.fn();
    render(<RecognitionResetDialog recognition="local" subtitleCount={2} isBusy onClose={onClose} onConfirm={onConfirm} />);
    for (const name of ['确认重新识别', '保留现有字幕', '关闭对话框']) {
      const button = screen.getByRole('button', { name }) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      fireEvent.click(button);
    }
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
