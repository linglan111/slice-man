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
    expect(screen.getByText(/在「API 服务」设置「文字请求并发上限」/).textContent).toContain('默认 2，可设为 1–16 的整数');
    await user.click(screen.getByRole('button', { name: '下一步' }));
    expect(screen.getByText(/会复用「全文章节切分」/).textContent).toContain('短视频也按章处理');
    await user.click(screen.getByRole('button', { name: '下一步' }));
    expect(screen.getByText(/每次切换操作时/).textContent).toContain('之后可拖动临时调整');
    for (let index = 0; index < 2; index++) await user.click(screen.getByRole('button', { name: '下一步' }));
    expect(screen.getByRole('status').textContent).toContain('第 5 / 6 步');
    expect(screen.getByText(/默认「中及以上」包含中、高/).textContent).toContain('1–20 轮');
    expect(screen.getByText(/跨越边界或重叠/)).toBeTruthy();
    expect(screen.getByText(/每轮对达到门槛的字幕重新识别/).textContent).toContain('原语言模式不会调用翻译服务');
    expect(screen.getByText(/结束前还会补查/).textContent).toContain('不增加修复轮数');
    expect(screen.getByText(/失败或取消会保留已完成的轮次/).textContent).toContain('不会当作没有疑点');
    await user.click(screen.getByRole('button', { name: '上一步' }));
    expect(screen.getByRole('heading', { name: '检查可疑字幕' })).toBeTruthy();
    expect(screen.getByText(/点击「AI 检查字幕」/).textContent).toContain('各范围都按整章上下文检查');
    expect(screen.getByText(/「人名检查」一次分析全片字幕/).textContent).toContain('不按章拆分');
    expect(screen.getByText(/处理时可查看当前阶段/).textContent).toContain('「查看流式信息」');
    expect(screen.getByText(/处理结果区的「AI 请求日志」/).textContent).toContain('失败后可重试');
    await user.click(screen.getByRole('button', { name: '下一步' }));
    await user.click(screen.getByRole('button', { name: '下一步' }));
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: '调整样式并导出' }));
    expect(screen.getByText(/关闭导航即可开始操作/).textContent).toContain('左上角的问号图标「功能导航」');
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
