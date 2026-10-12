import { useState, type ReactNode } from 'react';

const PREFERENCE_KEY = 'slice-man.secondary-expanded';

export function SecondaryControls({ initiallyExpanded, children }: { initiallyExpanded: boolean; children: ReactNode }): ReactNode {
  const [isExpanded, setIsExpanded] = useState(() => {
    try { const saved = localStorage.getItem(PREFERENCE_KEY); return saved === 'true' || saved === 'false' ? saved === 'true' : initiallyExpanded; }
    catch { return initiallyExpanded; }
  });
  function toggle(): void {
    const next = !isExpanded;
    try { localStorage.setItem(PREFERENCE_KEY, String(next)); } catch { /* Keep the user's choice in memory. */ }
    setIsExpanded(next);
  }
  return <section className={`secondary-controls ${isExpanded ? 'secondary-controls--expanded' : ''}`} aria-label="生成、样式与导出设置">
    <button className="secondary-controls__toggle" aria-expanded={isExpanded} aria-controls="secondary-content" onClick={toggle}>
      <span><strong>生成、样式与导出</strong><small>识别与翻译设置 · 字幕样式 · 已导出文件</small></span>
      <span>{isExpanded ? '收起' : '展开'} <span aria-hidden="true">{isExpanded ? '⌃' : '⌄'}</span></span>
    </button>
    <div id="secondary-content" className="work-grid__settings" hidden={!isExpanded}>{children}</div>
  </section>;
}
