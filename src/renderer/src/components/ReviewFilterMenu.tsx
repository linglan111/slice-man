import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { ReviewFilter } from '../lib/review-presentation';

type Choice = { value: ReviewFilter; label: string; count: number };
type Props = { value: ReviewFilter[]; choices: Choice[]; onChange: (filters: ReviewFilter[]) => void };

export function ReviewFilterMenu({ value, choices, onChange }: Props): ReactNode {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, maxHeight: 300 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const labels = choices.filter((choice) => value.includes(choice.value));
  const summary = labels.map((choice) => `${choice.label}（${choice.count}）`).join('、');
  useEffect(() => {
    if (!open) return;
    const updatePosition = (): void => {
      const bounds = triggerRef.current?.getBoundingClientRect();
      if (!bounds) return;
      const top = Math.max(8, Math.min(bounds.bottom + 6, window.innerHeight - 180));
      setPosition({ left: Math.max(8, Math.min(bounds.left, window.innerWidth - 248)), top, maxHeight: Math.max(100, window.innerHeight - top - 8) });
    };
    updatePosition();
    popupRef.current?.querySelector<HTMLInputElement>('input')?.focus();
    const handleOutside = (event: Event): void => {
      if (event.target instanceof Node && !popupRef.current?.contains(event.target) && !triggerRef.current?.contains(event.target)) setOpen(false);
    };
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); triggerRef.current?.focus(); }
    };
    document.addEventListener('pointerdown', handleOutside);
    document.addEventListener('focusin', handleOutside);
    document.addEventListener('keydown', handleKey);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      document.removeEventListener('pointerdown', handleOutside);
      document.removeEventListener('focusin', handleOutside);
      document.removeEventListener('keydown', handleKey);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open]);
  return <div className="review-filter">
    <button ref={triggerRef} className="button review-filter__trigger" type="button" aria-label="可疑度筛选" aria-expanded={open} title={summary} onClick={() => setOpen((current) => !current)}>{summary}<span aria-hidden="true">⌄</span></button>
    {open && createPortal(<div ref={popupRef} className="review-filter__popup" role="group" aria-label="可疑度筛选选项" style={{ position: 'fixed', left: position.left, top: position.top, maxHeight: position.maxHeight }}>
      <p className="hint">可同时选择多个等级</p>
      {choices.map((choice) => <label className="check-label" key={choice.value}><input type="checkbox" checked={value.includes(choice.value)} onChange={(event) => {
        if (choice.value === 'all') { onChange(['all']); return; }
        const current = value.filter((filter) => filter !== 'all');
        const next = event.target.checked ? [...current, choice.value] : current.filter((filter) => filter !== choice.value);
        onChange(next.length ? next : ['all']);
      }} />{choice.label}（{choice.count}）</label>)}
    </div>, document.body)}
  </div>;
}
