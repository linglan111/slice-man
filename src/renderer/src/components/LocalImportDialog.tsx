import { useState, type ReactNode } from 'react';
import type { Job } from '../../../shared/contracts';
import { requireResult } from '../lib/api-result';
import { ImportOptions, type ImportChoice } from './ImportOptions';
import { Modal } from './Modal';

export function LocalImportDialog({ onClose, onImported }: { onClose: () => void; onImported: (job: Job) => void }): ReactNode {
  const [choice, setChoice] = useState<ImportChoice>({ translationEnabled: false, targetLanguage: 'zh-CN' });
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState('');
  async function importVideo(): Promise<void> {
    setIsBusy(true); setError('');
    try {
      const job = await requireResult(window.api.jobs.importVideo(choice));
      if (job) onImported(job);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '导入失败，请重试。'); }
    finally { setIsBusy(false); }
  }
  return <Modal title="导入视频" onClose={onClose} isBusy={isBusy}><ImportOptions value={choice} onChange={setChoice} isBusy={isBusy} />{error && <p role="alert" className="error-message">{error}</p>}<footer className="modal__footer"><button className="button" disabled={isBusy} onClick={onClose}>取消</button><button className="button button--primary" disabled={isBusy} onClick={() => void importVideo()}>{isBusy ? '正在导入…' : '选择视频并导入'}</button></footer></Modal>;
}
