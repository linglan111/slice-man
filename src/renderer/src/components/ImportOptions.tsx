import type { ReactNode } from 'react';
import { LANGUAGES } from '../lib/presentation';

export type ImportChoice = { translationEnabled: boolean; targetLanguage: string };
export function ImportOptions({ value, onChange, isBusy = false }: { value: ImportChoice; onChange: (choice: ImportChoice) => void; isBusy?: boolean }): ReactNode {
  return <fieldset className="import-options"><legend>字幕语言</legend><label className="check-label"><input type="checkbox" aria-label="翻译字幕" disabled={isBusy} checked={value.translationEnabled} onChange={(event) => onChange({ ...value, translationEnabled: event.target.checked })} />翻译字幕</label><p className="hint">{value.translationEnabled ? '识别原文后翻译为目标语言，可随时校对。' : '仅生成原语言字幕，适合母语视频；所有处理步骤跳过翻译。'}</p>{value.translationEnabled && <label>目标语言<select aria-label="导入目标语言" disabled={isBusy} value={value.targetLanguage} onChange={(event) => onChange({ ...value, targetLanguage: event.target.value })}>{LANGUAGES.map((language) => <option key={language.value} value={language.value}>{language.label}</option>)}</select></label>}</fieldset>;
}
