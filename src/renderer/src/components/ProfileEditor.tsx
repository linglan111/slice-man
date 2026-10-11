import { useState, type ReactNode } from 'react';
import { profileInputSchema, type Profile, type ProfileInput } from '../../../shared/contracts';
import { Modal } from './Modal';

type Props = { profile?: Profile; onSave: (profile: ProfileInput) => Promise<void>; onClose: () => void };
const PROVIDER_DEFAULTS = { openai: { baseUrl: 'https://api.openai.com/v1', model: '填写模型 ID' }, anthropic: { baseUrl: 'https://api.anthropic.com/v1', model: '填写模型 ID' }, gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: '填写模型 ID' } };

export function ProfileEditor({ profile, onSave, onClose }: Props): ReactNode {
  const [name, setName] = useState(profile?.name ?? '');
  const [protocol, setProtocol] = useState<Profile['protocol']>(profile?.protocol ?? 'openai');
  const [mode, setMode] = useState<Profile['mode']>(profile?.mode ?? 'chat');
  const [baseUrl, setBaseUrl] = useState(profile?.baseUrl ?? PROVIDER_DEFAULTS.openai.baseUrl);
  const [model, setModel] = useState(profile?.model ?? '');
  const [apiKey, setApiKey] = useState('');
  const [sessionOnly, setSessionOnly] = useState(profile?.sessionOnly ?? false);
  const [structuredOutput, setStructuredOutput] = useState(profile?.structuredOutput ?? false);
  const [timeoutSeconds, setTimeoutSeconds] = useState(String((profile?.timeoutMs ?? 120000) / 1000));
  const [uploadMb, setUploadMb] = useState(String((profile?.maxUploadBytes ?? 24000000) / 1e6));
  const [error, setError] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  async function save(): Promise<void> {
    const input = { ...(profile ? { id: profile.id } : {}), name: name.trim(), protocol, mode, baseUrl: baseUrl.trim(), model: model.trim(), ...(apiKey ? { apiKey } : {}), sessionOnly, structuredOutput, timeoutMs: Number(timeoutSeconds) * 1000, maxUploadBytes: Number(uploadMb) * 1e6 };
    const parsed = profileInputSchema.safeParse(input);
    if (!parsed.success) { setError('请检查名称、有效接口地址、模型、超时（1–300 秒）和上传限制（0.1–100 MB）。'); return; }
    setError(''); setIsBusy(true);
    try { await onSave(parsed.data); setApiKey(''); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '配置保存失败，请重试。'); }
    finally { setIsBusy(false); }
  }
  return <Modal title={profile ? '编辑 API 服务' : '添加 API 服务'} onClose={onClose} isBusy={isBusy}>
    <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <label>配置名称<input aria-label="配置名称" value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：翻译服务、云端识别" /></label>
      <div className="form-grid"><label>协议<select aria-label="协议" value={protocol} onChange={(event) => {
        const next = profileInputSchema.shape.protocol.parse(event.target.value); setProtocol(next); setBaseUrl(PROVIDER_DEFAULTS[next].baseUrl); setMode('chat'); setStructuredOutput(false);
      }}>{profileInputSchema.shape.protocol.options.map((value) => <option key={value} value={value}>{value === 'openai' ? 'OpenAI 兼容' : value === 'anthropic' ? 'Anthropic' : 'Gemini'}</option>)}</select></label>
        {protocol === 'openai' && <label>文本接口<select aria-label="文本接口" value={mode} onChange={(event) => setMode(profileInputSchema.shape.mode.parse(event.target.value))}><option value="chat">Chat Completions</option><option value="responses">Responses</option></select></label>}</div>
      <label>接口地址<input aria-label="接口地址" type="url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} /></label>
      <label>模型 ID<input aria-label="模型 ID" value={model} onChange={(event) => setModel(event.target.value)} placeholder={PROVIDER_DEFAULTS[protocol].model} /></label>
      <label>API Key<input aria-label="API Key" type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={profile?.hasKey ? '已保存密钥；留空保留原密钥' : '填写自己的密钥'} /></label>
      <p className="hint">密钥在本地保护存储。云端识别上传音频；翻译与样式设计发送字幕文字。</p>
      <div className="form-grid"><label>请求超时（秒）<input aria-label="请求超时（秒）" type="number" min={1} max={300} value={timeoutSeconds} onChange={(event) => setTimeoutSeconds(event.target.value)} /></label>
        <label>音频上传上限（MB）<input aria-label="音频上传上限（MB）" type="number" min={.1} max={100} step={.1} value={uploadMb} onChange={(event) => setUploadMb(event.target.value)} /></label></div>
      <label className="check-label"><input type="checkbox" checked={sessionOnly} onChange={(event) => setSessionOnly(event.target.checked)} />仅本次会话使用密钥</label>
      {protocol === 'openai' && <label className="check-label"><input type="checkbox" checked={structuredOutput} onChange={(event) => setStructuredOutput(event.target.checked)} />服务已确认支持 JSON 输出模式</label>}
      {error && <p className="error-message" role="alert">{error}</p>}
      <footer className="modal__footer"><button type="button" className="button" disabled={isBusy} onClick={onClose}>取消</button><button className="button button--primary" disabled={isBusy}>{isBusy ? '保存中…' : '保存配置'}</button></footer>
    </form>
  </Modal>;
}


