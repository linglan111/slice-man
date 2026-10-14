import { useState, type ReactNode } from 'react';
import type { ChapterCriterion, CriterionLibrary } from '../../../shared/chapter-export-contracts';
import { requireResult } from '../lib/api-result';
import { Modal } from './Modal';

export function ChapterCriteriaDialog({ library, onChange, onClose }: {library: CriterionLibrary; onChange: (next: CriterionLibrary) => void; onClose: () => void}): ReactNode {
  const [editing, setEditing] = useState<ChapterCriterion>();
  const [name, setName] = useState('');
  const [instructions, setInstructions] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState('');
  function edit(item?: ChapterCriterion): void { setEditing(item); setName(item?.name ?? ''); setInstructions(item?.instructions ?? ''); setError(''); }
  async function perform(action: () => Promise<CriterionLibrary>, reset = false): Promise<void> {
    setIsBusy(true); setError('');
    try { onChange(await action()); if (reset) edit(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '标准保存失败'); }
    finally { setIsBusy(false); }
  }
  return <Modal title="管理自定义切分标准" onClose={onClose} isBusy={isBusy}>
    <p className="hint">标准用于新生成的自定义章节。已有章节保留生成时的标准快照。</p>
    <div className="chapter-criteria-list" aria-label="已保存标准">{library.items.map((item) => <div className="chapter-criterion" key={item.id}>
      <button className="text-button" disabled={isBusy} onClick={() => edit(item)}>{item.name}{library.selectedId === item.id ? ' · 已选择' : ''}</button>
      <button className="button" disabled={isBusy} aria-label={`复制 ${item.name}`} onClick={() => void perform(() => requireResult(window.api.chapterCriteria.copy({id: item.id, revision: item.revision})))}>复制</button>
      <button className="button" disabled={isBusy} aria-label={`删除 ${item.name}`} onClick={() => void perform(() => requireResult(window.api.chapterCriteria.remove({id: item.id, revision: item.revision})), editing?.id === item.id)}>删除</button>
    </div>)}</div>
    {!library.items.length && <p className="hint">暂无标准，可在下方新增；不会在下次启动时自动恢复。</p>}
    <form onSubmit={(event) => { event.preventDefault(); void perform(() => requireResult(window.api.chapterCriteria.save({ ...(editing ? {id: editing.id, revision: editing.revision} : {}), name, instructions })), true); }}>
      <div className="section-heading"><h3>{editing ? '编辑标准' : '新增标准'}</h3>{editing && <button type="button" className="text-button" disabled={isBusy} onClick={() => edit()}>改为新增</button>}</div>
      <label>标准名称<input aria-label="标准名称" maxLength={120} value={name} disabled={isBusy} onChange={(event) => setName(event.target.value)} required /></label>
      <label>切分要求<textarea aria-label="切分要求" rows={4} maxLength={8000} value={instructions} disabled={isBusy} onChange={(event) => setInstructions(event.target.value)} required /></label>
      {error && <p className="error-message" role="alert">{error}</p>}
      <footer className="modal__footer"><button type="button" className="button" disabled={isBusy} onClick={onClose}>返回章节</button><button className="button button--primary" disabled={isBusy || !name.trim() || !instructions.trim()}>保存标准</button></footer>
    </form>
  </Modal>;
}
