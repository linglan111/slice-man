// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Profile } from '../../../src/shared/contracts';
import { ChapterPanel } from '../../../src/renderer/src/components/ChapterPanel';
import { ChapterExportResults } from '../../../src/renderer/src/components/ChapterExportResults';
import { savedJob, stubApi } from './app-fixtures';
const profile: Profile = {id:'p', name:'chapter-service', protocol:'openai', mode:'chat', baseUrl:'https://example.com/v1', model:'test', hasKey:true, sessionOnly:false, structuredOutput:false, timeoutMs:120000, maxUploadBytes:24000000};
beforeAll(() => {HTMLDialogElement.prototype.showModal=function():void {this.open=true;}; HTMLDialogElement.prototype.close=function():void {this.open=false;};});
afterEach(cleanup);
function fixture(): {props: Parameters<typeof ChapterPanel>[0]; api: ReturnType<typeof stubApi>['api']} {
  const job=savedJob(); job.options.chapterProfileId='p';
  job.chapterPlan={version:1,id:'plan',revision:0,kind:'normal',sourceFingerprint:'fingerprint',state:'current',createdAt:0,chapters:[{id:'one',startMs:0,endMs:job.media.durationMs,title:'first',summary:'summary'}]};
  const {api}=stubApi(job);
  const props: Parameters<typeof ChapterPanel>[0]={job, profiles:[profile], isBusy:false, onPlan:vi.fn().mockResolvedValue(undefined), onUpdate:vi.fn().mockResolvedValue(undefined), onExport:vi.fn().mockResolvedValue(null), onSeek:vi.fn(), onClose:vi.fn()};
  return {props,api};
}
describe('chapter panel explicit operations', () => {
  it('explains full chapter reuse and recognition/name exceptions without starting work', async () => {
    const { props } = fixture(); render(<ChapterPanel {...props} />);
    await screen.findByRole('option', { name: '全文章节切分' });
    fireEvent.click(screen.getByRole('button', { name: '了解全文章节切分' }));
    const dialog = screen.getByRole('dialog', { name: '全文章节切分说明' });
    expect(dialog.textContent).toContain('整章字幕的时轴、原文和已启用的译文');
    expect(dialog.textContent).toContain('语音识别与人名检查不使用全文章节切分');
    fireEvent.click(screen.getByRole('button', { name: '知道了' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(props.onPlan).not.toHaveBeenCalled();
  });
  it('only reads when opened, seeks and selects without AI or export', async () => {
    const {props,api}=fixture(); render(<ChapterPanel {...props} />);
    await waitFor(() => expect(api.chapterCriteria.list).toHaveBeenCalledOnce());
    expect(props.onPlan).not.toHaveBeenCalled(); expect(props.onExport).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:/定位/})); expect(props.onSeek).toHaveBeenCalledWith(0);
    fireEvent.click(screen.getByRole('button',{name:'全选章节'})); expect(screen.getByRole('button',{name:'取消全选章节'})).toBeTruthy(); expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('button',{name:'取消全选章节'})); expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
  });
  it('requires saving or abandoning edits before export and sends exact plan revision', async () => {
    const {props}=fixture(); render(<ChapterPanel {...props} />);
    fireEvent.click(screen.getByRole('button',{name:'全选章节'}));
    fireEvent.change(screen.getByLabelText('章节 1 标题'),{target:{value:'edited'}});
    expect((screen.getByRole('button',{name:'导出所选章节（1）'}) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button',{name:'保存章节修改'}));
    await waitFor(() => expect(props.onUpdate).toHaveBeenCalledWith(expect.objectContaining({jobId:props.job.id,revision:props.job.revision,planId:'plan',planRevision:0,chapters:[expect.objectContaining({title:'edited'})]})));
  });
  it('supports empty library, explicit criteria CRUD and one close in its dialog', async () => {
    const {props,api}=fixture(); vi.mocked(api.chapterCriteria.save).mockResolvedValue({success:true,data:{items:[]}});
    render(<ChapterPanel {...props} />);
    fireEvent.change(screen.getByLabelText('章节类型'),{target:{value:'custom'}});
    expect((screen.getByRole('button',{name:'AI 切分章节'}) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button',{name:'管理切分标准'}));
    expect(screen.getAllByRole('button',{name:'关闭对话框'})).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('标准名称'),{target:{value:'teaching'}});
    fireEvent.change(screen.getByLabelText('切分要求'),{target:{value:'core explanations'}});
    fireEvent.click(screen.getByRole('button',{name:'保存标准'}));
    await waitFor(() => expect(api.chapterCriteria.save).toHaveBeenCalledWith({name:'teaching',instructions:'core explanations'}));
    expect(props.onPlan).not.toHaveBeenCalled();
  });
  it('shows retained clip results and offers only current matching incomplete runs', async () => {
    const {props,api}=fixture(); const input={jobId:props.job.id,revision:props.job.revision,planId:'plan',planRevision:0,chapterIds:['one'],format:'srt' as const};
    vi.mocked(api.chapterExports.list).mockResolvedValue({success:true,data:[{version:1,id:'run',jobId:props.job.id,planId:'plan',planRevision:0,input,identity:'a'.repeat(64),state:'interrupted',startedAt:0,clips:[{chapterId:'one',title:'first',state:'pending'}]}]});
    const onResume=vi.fn().mockResolvedValue(undefined); const view=render(<ChapterExportResults job={props.job} isBusy={false} onResume={onResume} />);
    fireEvent.click(await screen.findByRole('button',{name:'继续未完成章节'})); expect(onResume).toHaveBeenCalledWith({...input,runId:'run'});
    view.rerender(<ChapterExportResults job={{...props.job,revision:props.job.revision+1}} isBusy={false} onResume={onResume} />);
    expect(screen.queryByRole('button',{name:'继续未完成章节'})).toBeNull();
  });
});
