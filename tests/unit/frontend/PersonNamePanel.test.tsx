// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PersonNamePanel } from '../../../src/renderer/src/components/PersonNamePanel';
import { savedJob } from './app-fixtures';
import type { NameReport } from '../../../src/shared/contracts';
afterEach(cleanup);
function props(): Parameters<typeof PersonNamePanel>[0] {
  const job = savedJob(); job.options.reviewProfileId = 'profile'; job.segments[0] = { ...job.segments[0] as typeof job.segments[number], sourceText: 'Ann says hello', translatedText: '安娜问好' };
  const report: NameReport = { version: 1, id: 'r', profileId: 'profile', providerFingerprint: 'f', revision: 7, createdAt: 1, timelineFingerprint: 't', state: 'current', translationEnabled: true, candidates: [{ id: 'c', sourceAliases: ['Ann'], translatedAliases: ['安娜'], sourceName: 'Anne', translatedName: '安妮', reason: '名字重复', occurrences: [{ segmentId: 'old-cue', field: 'sourceText', start: 0, end: 3 }, { segmentId: 'other', field: 'sourceText', start: 0, end: 3 }], cueCount: 2, sourceCount: 2, translatedCount: 0 }] };
  job.nameReport = report;
  return { job, isBusy: false, onAnalyze: vi.fn(), onApply: vi.fn(), onUndo: vi.fn(), onCancel: vi.fn(), onChooseProfile: vi.fn() };
}
describe('reviewable names panel', () => {
  it('initializes editable recommended values without mutation, retains input during rerender and sends current revision', () => {
    const p = props(); const view = render(<PersonNamePanel {...p} />);
    expect((screen.getByLabelText('Anne 替换原名') as HTMLInputElement).value).toBe('Anne'); expect(p.onApply).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Anne 替换原名'), { target: { value: 'Annie' } });
    view.rerender(<PersonNamePanel {...p} job={{ ...p.job, revision: 8 }} />);
    fireEvent.click(screen.getByRole('button', { name: '应用选中人名' }));
    expect(p.onApply).toHaveBeenCalledWith({ jobId: p.job.id, revision: 8, reportId: 'r', mappings: [{ candidateId: 'c', sourceName: 'Annie', translatedName: '安妮', enabled: true }] });
    expect(screen.getByText('Ann says hello', { exact: false })).toBeTruthy();
  });
  it('supports deselection/cancel, shows stale explanation and never applies stale data', () => {
    const p = props(); const view = render(<PersonNamePanel {...p} />);
    fireEvent.click(screen.getByRole('checkbox')); expect((screen.getByRole('button', { name: '应用选中人名' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '取消人名修改' })); expect(p.onCancel).toHaveBeenCalledOnce();
    if (!p.job.nameReport) throw new Error('missing'); view.rerender(<PersonNamePanel {...p} job={{ ...p.job, nameReport: { ...p.job.nameReport, state: 'stale' } }} />);
    expect(screen.getByRole('status').textContent).toContain('重新分析'); expect((screen.getByRole('button', { name: '应用选中人名' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('explains missing service, hides inactive translations and keeps no-report cancel available', () => {
    const p = props(); p.job.options.translationEnabled = false; p.job.options.reviewProfileId = undefined; p.job.nameReport = undefined;
    render(<PersonNamePanel {...p} />); fireEvent.click(screen.getByRole('button', { name: 'AI 检查人名' })); expect(p.onChooseProfile).toHaveBeenCalledOnce();
    expect(screen.queryByLabelText('Anne 替换译名')).toBeNull(); expect(screen.getByRole('button', { name: '取消人名修改' })).toBeTruthy();
  });
  it('undo submits current revision and displays preserved conflict fields after consumption', () => {
    const p = props(); p.job.nameBatch = { version: 1, id: 'batch', state: 'available', appliedAt: 1, appliedRevision: 6, changedCueCount: 1, patches: [], emphasisPatches: [] };
    const view = render(<PersonNamePanel {...p} />); fireEvent.click(screen.getByRole('button', { name: '撤销上次人名修改' })); expect(p.onUndo).toHaveBeenCalledWith({ jobId: p.job.id, revision: 7, batchId: 'batch' });
    view.rerender(<PersonNamePanel {...p} job={{ ...p.job, nameBatch: { ...p.job.nameBatch, state: 'consumed', undo: { restoredFields: 1, restoredEmphasis: 0, skippedFields: 1, conflicts: [{ segmentId: 'old-cue', field: 'sourceText', reason: 'changed' }] } } }} />);
    expect(screen.getByRole('status').textContent).toContain('保留 1'); expect(screen.getByText('查看未回退条目（1）')).toBeTruthy(); expect(screen.queryByRole('button', { name: '撤销上次人名修改' })).toBeNull();
  });
});
