import { useEffect, useRef, type PointerEvent, type ReactNode } from 'react';
import { clamp } from '../lib/layout-preferences';

type Props = { label: string; orientation: 'vertical' | 'horizontal'; value: number; minimum: number; maximum: number; onChange: (value: number, commit: boolean) => void; cancel: () => void; className?: string; position?: number };
export function PaneDivider({ label, orientation, value, minimum, maximum, onChange, cancel, className = '', position }: Props): ReactNode {
  const drag = useRef<{ id: number; coordinate: number; value: number; current: number; element: HTMLDivElement } | null>(null);
  const dividerRef = useRef<HTMLDivElement>(null);
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  const cancelRef = useRef(cancel);
  cancelRef.current = cancel;
  const vertical = orientation === 'vertical';
  function finish(cancelled: boolean): void {
    const active = drag.current;
    if (!active) return;
    drag.current = null;
    if (active.element.hasPointerCapture(active.id)) active.element.releasePointerCapture(active.id);
    document.body.classList.remove('pane-dragging', 'pane-dragging--vertical', 'pane-dragging--horizontal');
    if (cancelled) cancelRef.current();
    else changeRef.current(clamp(active.current, minimum, maximum), true);
  }
  useEffect(() => {
    function cancelDrag(): void {
      const active = drag.current;
      drag.current = null;
      if (active?.element.hasPointerCapture(active.id)) active.element.releasePointerCapture(active.id);
      if (active) cancelRef.current();
      document.body.classList.remove('pane-dragging', 'pane-dragging--vertical', 'pane-dragging--horizontal');
    }
    const observer = new ResizeObserver((entries) => {
      if (drag.current && entries.some((entry) => !entry.contentRect.width || !entry.contentRect.height)) cancelDrag();
    });
    if (dividerRef.current) observer.observe(dividerRef.current);
    return () => { observer.disconnect(); cancelDrag(); };
  }, []);
  function start(event: PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return;
    event.preventDefault(); event.currentTarget.focus();
    drag.current = { id: event.pointerId, coordinate: vertical ? event.clientX : event.clientY, value, current: value, element: event.currentTarget };
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.classList.add('pane-dragging', vertical ? 'pane-dragging--vertical' : 'pane-dragging--horizontal');
  }
  return <div ref={dividerRef} className={`pane-divider pane-divider--${orientation} ${className}`} role="separator" tabIndex={0} aria-label={label} aria-orientation={orientation} aria-valuemin={Math.round(minimum)} aria-valuemax={Math.round(Math.max(minimum, maximum))} aria-valuenow={Math.round(value)} aria-valuetext={`${Math.round(value)} 像素`} title={`${label}：拖动或使用方向键调整，Home/End 调至边界`} style={position === undefined ? undefined : vertical ? { left: position } : { top: position }} onPointerDown={start} onPointerMove={(event) => {
    const active = drag.current;
    if (!active || active.id !== event.pointerId) return;
    const coordinate = vertical ? event.clientX : event.clientY;
    active.current = clamp(active.value + coordinate - active.coordinate, minimum, maximum);
    onChange(active.current, false);
  }} onPointerUp={() => finish(false)} onPointerCancel={() => finish(true)} onLostPointerCapture={() => finish(true)} onKeyDown={(event) => {
    if (event.key === 'Escape' && drag.current) { event.preventDefault(); finish(true); return; }
    const backwards = vertical ? 'ArrowLeft' : 'ArrowUp'; const forwards = vertical ? 'ArrowRight' : 'ArrowDown';
    if (![backwards, forwards, 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const delta = event.shiftKey ? 40 : 10;
    onChange(clamp(event.key === 'Home' ? minimum : event.key === 'End' ? maximum : value + (event.key === backwards ? -delta : delta), minimum, maximum), true);
  }} />;
}
