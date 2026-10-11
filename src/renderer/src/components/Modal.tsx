import { useEffect, useId, useRef, type ReactNode } from 'react';

type ModalProps = {
  title: string;
  children: ReactNode;
  onClose: () => void;
  isBusy?: boolean;
  className?: string;
};

/** Native dialog provides keyboard focus containment without browser alert APIs. */
export function Modal({ title, children, onClose, isBusy = false, className = '' }: ModalProps): ReactNode {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      dialog?.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);
  return (
    <dialog ref={dialogRef} className={`modal ${className}`} aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); if (!isBusy) onClose(); }}>
      <header className="modal__header"><h2 id={titleId}>{title}</h2>
        <button className="icon-button" aria-label="关闭对话框" disabled={isBusy} onClick={onClose}>×</button>
      </header>
      {children}
    </dialog>
  );
}
