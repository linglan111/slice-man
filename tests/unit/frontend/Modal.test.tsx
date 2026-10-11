// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Modal } from '../../../src/renderer/src/components/Modal';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function (): void { this.open = true; };
  HTMLDialogElement.prototype.close = function (): void { this.open = false; };
});
afterEach(cleanup);

describe('Modal keyboard and focus lifecycle', () => {
  it('exposes its title and restores focus after closing', () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    const view = render(<Modal title="字幕校对" onClose={vi.fn()}><input aria-label="译文" /></Modal>);
    expect(screen.getByRole('dialog', { name: '字幕校对' })).toBeTruthy();
    screen.getByLabelText('译文').focus();
    view.unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('handles Escape cancellation without leaving a browser dialog open', () => {
    const onClose = vi.fn();
    render(<Modal title="设置" onClose={onClose}>设置内容</Modal>);
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('blocks close while a save is active', () => {
    const onClose = vi.fn();
    render(<Modal title="保存" onClose={onClose} isBusy>正在保存</Modal>);
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    fireEvent.click(screen.getByLabelText('关闭对话框'));
    expect(onClose).not.toHaveBeenCalled();
  });
});
