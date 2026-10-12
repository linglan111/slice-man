// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FeatureGuide } from '../../../src/renderer/src/components/FeatureGuide';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function (): void { this.open = true; };
  HTMLDialogElement.prototype.close = function (): void { this.open = false; };
});
afterEach(cleanup);

describe('feature guide', () => {
  it('navigates all six steps, announces focus, and explains safe scoped repair', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<FeatureGuide onClose={onClose} />);
    expect(screen.getByRole('dialog', { name: '功能导航' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '上一步' }).hasAttribute('disabled')).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: '准备识别与 AI 服务' }));
    for (let index = 0; index < 4; index++) await user.click(screen.getByRole('button', { name: '下一步' }));
    expect(screen.getByRole('status').textContent).toContain('第 5 / 6 步');
    expect(screen.getByText(/默认「中及以上」包含中、高/).textContent).toContain('1–20 轮');
    expect(screen.getByText(/跨越边界或重叠/)).toBeTruthy();
    expect(screen.getByText(/原文或时间问题重新识别/).textContent).toContain('原语言模式不会调用翻译服务');
    await user.click(screen.getByRole('button', { name: '上一步' }));
    expect(screen.getByRole('heading', { name: '检查可疑字幕' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '下一步' }));
    await user.click(screen.getByRole('button', { name: '下一步' }));
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: '调整样式并导出' }));
    await user.click(screen.getByRole('button', { name: '完成' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
  it.each(['header', 'later', 'escape'])('delegates %s dismissal without writing preferences itself', async (method) => {
    const onClose = vi.fn();
    const storage = vi.spyOn(Storage.prototype, 'setItem');
    render(<FeatureGuide onClose={onClose} />);
    if (method === 'escape') fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    else await userEvent.click(screen.getByRole('button', { name: method === 'header' ? '关闭对话框' : '稍后再看' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(storage).not.toHaveBeenCalled();
    storage.mockRestore();
  });
  it('restarts at step one on replay and restores the trigger focus', async () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    const view = render(<FeatureGuide onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: '下一步' }));
    view.unmount();
    expect(document.activeElement).toBe(trigger);
    const replay = render(<FeatureGuide onClose={vi.fn()} />);
    expect(screen.getByRole('status').textContent).toContain('第 1 / 6 步');
    replay.unmount();
    trigger.remove();
  });
});
