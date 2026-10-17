// @vitest-environment jsdom
import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProfileEditor } from '../../../src/renderer/src/components/ProfileEditor';
import type { Profile } from '../../../src/shared/contracts';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function (): void { this.open = true; };
  HTMLDialogElement.prototype.close = function (): void { this.open = false; };
});
afterEach(cleanup);
const PROFILE: Profile = { id: 'p', name: '我的服务', protocol: 'openai', mode: 'chat', baseUrl: 'https://example.com/v1', model: 'test-model', hasKey: true, sessionOnly: false, timeoutMs: 120000, maxUploadBytes: 24000000, structuredOutput: false };

describe('ProfileEditor configuration and credential behavior', () => {
  it('loads the legacy concurrency default and saves a bounded per-service limit', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ProfileEditor profile={PROFILE} onSave={onSave} onClose={vi.fn()} />);
    expect((screen.getByLabelText('文字请求并发上限') as HTMLInputElement).value).toBe('2');
    fireEvent.change(screen.getByLabelText('文字请求并发上限'), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ textConcurrency: 4 })));
  });
  it.each(['', '0', '17', '1.5'])('rejects invalid service concurrency %s before save', (value) => {
    const onSave = vi.fn();
    render(<ProfileEditor profile={PROFILE} onSave={onSave} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('文字请求并发上限'), { target: { value } });
    fireEvent.submit(screen.getByRole('button', { name: '保存配置' }).closest('form') as HTMLFormElement);
    expect(screen.getByRole('alert').textContent).toContain('文字请求并发上限');
    expect(onSave).not.toHaveBeenCalled();
  });
  it('exposes streaming compatibility and saves a separate bounded overall generation deadline', async () => {
    const onSave=vi.fn().mockResolvedValue(undefined); render(<ProfileEditor profile={PROFILE} onSave={onSave} onClose={vi.fn()} />);
    expect((screen.getByLabelText('文字生成总时限（分钟）') as HTMLInputElement).value).toBe('30');
    fireEvent.change(screen.getByLabelText('文字生成总时限（分钟）'),{target:{value:'45'}});
    fireEvent.change(screen.getByLabelText('文字响应方式'),{target:{value:'disabled'}});
    fireEvent.click(screen.getByRole('button',{name:'保存配置'}));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({streaming:'disabled',textTimeoutMs:2700000,timeoutMs:120000})));
  });
  it('blocks an incomplete model without calling the backend', () => {
    const onSave = vi.fn();
    render(<ProfileEditor onSave={onSave} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
    expect(screen.getByRole('alert').textContent).toContain('模型');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('saves changed protocol with its endpoint and excludes blank saved-key entries', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ProfileEditor profile={PROFILE} onSave={onSave} onClose={vi.fn()} />);
    expect((screen.getByLabelText('API Key') as HTMLInputElement).value).toBe('');
    fireEvent.change(screen.getByLabelText('协议'), { target: { value: 'anthropic' } });
    expect(screen.queryByLabelText('文本接口')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    const input: unknown = onSave.mock.calls[0]?.[0];
    expect(input).toMatchObject({ id: 'p', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'test-model' });
    expect(input).not.toHaveProperty('apiKey');
  });

  it('offers optional JSON output mode only for OpenAI and clears it on protocol changes', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ProfileEditor profile={PROFILE} onSave={onSave} onClose={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('服务已确认支持 JSON 输出模式'));
    fireEvent.change(screen.getByLabelText('协议'), { target: { value: 'gemini' } });
    expect(screen.queryByLabelText('服务已确认支持 JSON 输出模式')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ protocol: 'gemini', structuredOutput: false });
  });

  it('shows a protected-storage failure while retaining drafts for session-only retry', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('无法保护密钥，请改用仅会话方式。'));
    render(<ProfileEditor profile={PROFILE} onSave={onSave} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'private-test-key' } });
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('仅会话'));
    expect((screen.getByLabelText('API Key') as HTMLInputElement).value).toBe('private-test-key');
    expect(screen.getByLabelText('仅本次会话使用密钥')).toBeTruthy();
  });
});
