import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { cn } from '../lib/cn';
import { Button } from './ui';

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

function lockBodyScroll(lock: boolean) {
  const html = document.documentElement;
  const body = document.body;
  if (lock) {
    html.dataset.zmModalLock = String(Number(html.dataset.zmModalLock || '0') + 1);
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    return;
  }
  const next = Math.max(0, Number(html.dataset.zmModalLock || '1') - 1);
  html.dataset.zmModalLock = String(next);
  if (next > 0) return;
  // Keep document locked while the app shell is mounted.
  if (document.querySelector('[data-testid="app-shell"]')) {
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    return;
  }
  html.style.overflow = '';
  body.style.overflow = '';
}

function getFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('disabled') && el.offsetParent !== null,
  );
}

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Optional sticky custom header (replaces default title row content when set). */
  header?: ReactNode;
  size?: ModalSize;
  /** When true, overlay/Esc ask before closing. */
  dirty?: boolean;
  onDiscardConfirm?: () => void;
  testId?: string;
  /** When false, hide the header close button (e.g. enforce password policy). */
  closable?: boolean;
  /** Body fills remaining height with overflow hidden (for split panes that scroll themselves). */
  fillBody?: boolean;
  /** Extra classes on the scroll/body region. */
  bodyClassName?: string;
};

const sizeClass: Record<ModalSize, string> = {
  sm: 'sm:max-w-[420px]',
  md: 'sm:max-w-[560px]',
  lg: 'sm:max-w-[720px]',
  xl: 'sm:max-w-[1200px]',
  full: 'sm:max-w-[min(1400px,96vw)] max-h-[100dvh] sm:max-h-[96dvh] sm:rounded-[24px]',
};

/** Centered dialog (bottom sheet below 640px). */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  header,
  size = 'md',
  dirty = false,
  onDiscardConfirm,
  testId = 'modal',
  closable = true,
  fillBody = false,
  bodyClassName,
}: ModalProps) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const titleId = useId();
  const descId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const prevFocus = useRef<HTMLElement | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);

  const requestClose = () => {
    if (!closable && !dirty) return;
    if (dirty) {
      setDiscardOpen(true);
      return;
    }
    onClose();
  };

  useEffect(() => {
    if (!open) return;
    prevFocus.current = document.activeElement as HTMLElement | null;
    lockBodyScroll(true);
    const id = window.setTimeout(() => {
      const first = panelRef.current ? getFocusable(panelRef.current)[0] : null;
      (first || panelRef.current)?.focus();
    }, 10);
    return () => {
      window.clearTimeout(id);
      lockBodyScroll(false);
      prevFocus.current?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (discardOpen) {
          setDiscardOpen(false);
          return;
        }
        requestClose();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const nodes = getFocusable(panelRef.current);
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, dirty, discardOpen]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-4" data-testid={testId}>
      <button
        type="button"
        className={cn(
          'zm-backdrop absolute inset-0 bg-ink/45 backdrop-blur-md',
          !reduce && 'animate-fadeIn',
        )}
        aria-label={t('common.close')}
        data-testid="modal-overlay"
        onClick={requestClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        data-testid="modal-panel"
        className={cn(
          'zm-glass zm-glass-strong relative z-10 flex w-full max-h-[92dvh] flex-col overflow-hidden rounded-t-[28px] outline-none sm:max-h-[90dvh] sm:rounded-[32px]',
          'text-ink',
          size === 'full' && 'h-[100dvh] sm:h-auto rounded-none',
          sizeClass[size],
          !reduce && 'animate-modalIn',
        )}
      >
        <header
          className="sticky top-0 z-10 flex shrink-0 items-start justify-between gap-2 border-b border-[var(--zm-separator)] bg-[var(--zm-glass-bg,var(--color-surface))] px-4 py-2 sm:px-5"
          data-testid="modal-sticky-header"
        >
          <div className="min-w-0 flex-1">
            {header ? (
              header
            ) : (
              <>
                <h2 id={titleId} className="text-lg font-semibold tracking-tight text-ink">
                  {title}
                </h2>
                {description ? (
                  <p id={descId} className="mt-0.5 text-sm text-ink-muted">
                    {description}
                  </p>
                ) : null}
              </>
            )}
            {header ? (
              <h2 id={titleId} className="sr-only">
                {title}
              </h2>
            ) : null}
          </div>
          {closable ? (
            <button
              type="button"
              className="touch-target inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--zm-separator)] text-ink-muted hover:bg-surface-muted"
              aria-label={t('common.close')}
              onClick={requestClose}
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </header>
        <div
          className={cn(
            'min-h-0 flex-1 overscroll-contain',
            fillBody
              ? 'flex flex-col overflow-hidden p-0'
              : 'overflow-y-auto scroll-pt-4 px-4 pb-4 pt-3 sm:px-5',
            bodyClassName,
          )}
          data-testid="modal-body"
        >
          {children}
        </div>
        {footer ? (
          <footer
            className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-[var(--zm-separator)] px-4 py-3 sm:px-5"
            data-testid="modal-sticky-footer"
          >
            {footer}
          </footer>
        ) : null}
      </div>

      {discardOpen ? (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-ink/40 p-4">
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={`${titleId}-discard`}
            className="zm-glass zm-glass-strong w-full max-w-sm rounded-[24px] p-4 !shadow-lift"
          >
            <p id={`${titleId}-discard`} className="text-sm font-semibold text-ink">
              {t('common.discardChanges')}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setDiscardOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button
                type="button"
                variant="danger"
                size="sm"
                onClick={() => {
                  setDiscardOpen(false);
                  onDiscardConfirm?.();
                  onClose();
                }}
              >
                {t('common.confirm')}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}

type ConfirmVariant = 'default' | 'danger';

type ConfirmDialogProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmVariant;
  /** Require typing this exact string to enable confirm (delete). */
  typeToConfirm?: string;
  loading?: boolean;
};

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  cancelLabel,
  variant = 'default',
  typeToConfirm,
  loading,
}: ConfirmDialogProps) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setTyped('');
  }, [open]);

  const canConfirm = !typeToConfirm || typed === typeToConfirm;

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!canConfirm || busy || loading) return;
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      testId="confirm-dialog"
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy || loading}>
            {cancelLabel || t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant={variant === 'danger' ? 'danger' : 'primary'}
            loading={busy || loading}
            disabled={!canConfirm}
            onClick={() => void submit()}
          >
            {confirmLabel || t('common.confirm')}
          </Button>
        </>
      }
    >
      {typeToConfirm ? (
        <label className="block text-sm">
          <span className="mb-1 block text-ink-muted">{t('common.typeToConfirm', { value: typeToConfirm })}</span>
          <input
            className="h-10 w-full rounded-control border border-border bg-surface px-3 text-sm"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            data-testid="type-to-confirm"
          />
        </label>
      ) : (
        <p className="text-sm text-ink-muted">{description}</p>
      )}
    </Modal>
  );
}

/** Right-side drawer for read-only detail views. */
export function DetailDrawer({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const panelRef = useRef<HTMLAsideElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    panelRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[55] flex justify-end" data-testid="detail-drawer">
      <button type="button" className="absolute inset-0 bg-ink/40" aria-label={t('common.close')} onClick={onClose} />
      <aside
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-10 flex h-full w-full max-w-md flex-col border-l border-border bg-surface shadow-lift outline-none"
      >
        <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
          <h2 id={titleId} className="text-lg font-semibold">
            {title}
          </h2>
          <button
            type="button"
            className="rounded-control border border-border p-2"
            aria-label={t('common.close')}
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      </aside>
    </div>,
    document.body,
  );
}
