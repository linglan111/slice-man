import { useState, type ReactNode } from 'react';
import type { Profile } from '../../../shared/contracts';
import { Modal } from './Modal';

type Props = { profiles: Profile[]; onEdit: (profile?: Profile) => void; onTest: (id: string, purpose: 'text' | 'recognition') => Promise<string>; onRemove: (id: string) => Promise<void>; onClose: () => void };
export function ProfileManager({ profiles, onEdit, onTest, onRemove, onClose }: Props): ReactNode {
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [purpose, setPurpose] = useState<'text' | 'recognition'>('text');
  const [removeId, setRemoveId] = useState('');
  async function test(id: string): Promise<void> {
    setBusyId(id); setError(''); setMessage('');
    try { setMessage(await onTest(id, purpose)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '连接失败，请检查接口和密钥。'); }
    finally { setBusyId(''); }
  }
  async function remove(id: string): Promise<void> {
    setBusyId(id); setError('');
    try { await onRemove(id); setRemoveId(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '删除配置失败。'); }
    finally { setBusyId(''); }
  }
  return <Modal title="API 服务" onClose={onClose} isBusy={Boolean(busyId)} className="modal--wide">
    <p className="hint">识别、翻译与样式可分别选择服务。每套配置对应一个模型。</p>
    <label>连接测试用途<select aria-label="连接测试用途" value={purpose} disabled={Boolean(busyId)} onChange={(event) => setPurpose(event.target.value === 'recognition' ? 'recognition' : 'text')}><option value="text">文字翻译 / 样式</option><option value="recognition">音频识别 / 时间戳</option></select></label>
    <div className="profile-list">{profiles.map((profile) => <article className="profile-card" key={profile.id}><div><strong>{profile.name}</strong><p>{profile.protocol.toUpperCase()} · {profile.model}</p><span className="hint">{profile.hasKey ? '密钥已配置' : '未配置密钥'}{profile.sessionOnly ? ' · 仅会话' : ''}</span></div>
      <div className="profile-card__actions"><button className="button" disabled={Boolean(busyId)} onClick={() => void test(profile.id)}>{busyId === profile.id ? '处理中…' : '测试连接'}</button><button className="button" disabled={Boolean(busyId)} onClick={() => onEdit(profile)}>编辑</button><button className="text-button text-button--danger" disabled={Boolean(busyId)} onClick={() => setRemoveId(profile.id)}>删除</button></div>
      {removeId === profile.id && <div className="remove-confirm"><span>删除此 API 配置？项目可能需要重新选择服务。</span><button className="button" onClick={() => setRemoveId('')}>保留</button><button className="button" disabled={Boolean(busyId)} onClick={() => void remove(profile.id)}>确认删除</button></div>}
    </article>)}{!profiles.length && <p className="editor-empty">添加你的第一个服务，开始识别或翻译。</p>}</div>
    {message && <p className="success-message" role="status">{message}</p>}{error && <p className="error-message" role="alert">{error}</p>}
    <footer className="modal__footer"><button className="button button--primary" onClick={() => onEdit()}>添加服务</button></footer>
  </Modal>;
}

