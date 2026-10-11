import type { ReactNode } from 'react';
import { Modal } from './Modal';

type Props = { recognition: 'local' | 'cloud'; subtitleCount: number; hasEmphasis?: boolean; isBusy?: boolean; onClose: () => void; onConfirm: () => void };

export function RecognitionResetDialog({ recognition, subtitleCount, hasEmphasis = false, isBusy = false, onClose, onConfirm }: Props): ReactNode {
  return <Modal title="重新识别原片" onClose={onClose} isBusy={isBusy}>
    <p>这会重新识别原片中的语音。识别成功后，当前 {subtitleCount} 条字幕的原文、译文和手工校对将被新的识别结果替换。</p>
    <p>导出状态将失效，需要重新生成。已有导出文件会保留。</p>
    {hasEmphasis && <p>逐句关键词强调将清除，整体样式保留。</p>}
    <p>取消或识别失败时，已有字幕和校对结果会保留。识别成功后不会自动翻译，请检查结果后再发起翻译。</p>
    {recognition === 'cloud' ? <p className="hint">当前使用云端识别：将重新上传原片音频，服务商可能收取费用。</p> : <p className="hint">当前使用本地 Whisper，识别过程不会上传原片音频。</p>}
    <footer className="modal__footer"><button className="button" disabled={isBusy} onClick={onClose}>保留现有字幕</button><button className="button button--primary" disabled={isBusy} onClick={onConfirm}>确认重新识别</button></footer>
  </Modal>;
}
