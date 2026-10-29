import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  /** Destructive actions get a red confirm button. */
  danger?: boolean;
}

type Confirm = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Confirm | null>(null);

/**
 * An in-app replacement for window.confirm(): styled like the rest of the app, and built on the
 * native <dialog> element, so focus trapping, Escape-to-cancel and the backdrop come for free.
 *
 *   const confirm = useConfirm();
 *   if (await confirm({ title: "Delete EECS 2030?", danger: true })) remove();
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const resolveRef = useRef<((ok: boolean) => void) | null>(null);
  const [options, setOptions] = useState<ConfirmOptions | null>(null);

  const confirm = useCallback<Confirm>((next) => {
    setOptions(next);
    dialogRef.current?.showModal();
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  function close(ok: boolean) {
    dialogRef.current?.close();
    resolveRef.current?.(ok);
    resolveRef.current = null;
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <dialog
        ref={dialogRef}
        className="dialog"
        aria-labelledby="confirm-title"
        aria-describedby={options?.message ? "confirm-message" : undefined}
        // Escape (the native "cancel" event) counts as "no".
        onCancel={(e) => {
          e.preventDefault();
          close(false);
        }}
        // A click on the backdrop (outside the panel) also cancels.
        onClick={(e) => {
          if (e.target === e.currentTarget) close(false);
        }}
      >
        <div className="dialog-panel">
          <h2 id="confirm-title">{options?.title}</h2>
          {options?.message && (
            <p id="confirm-message" className="muted">
              {options.message}
            </p>
          )}
          <div className="dialog-actions">
            {/* autoFocus on Cancel: Enter on a destructive dialog should never delete by accident. */}
            <button type="button" className="btn btn-ghost" autoFocus onClick={() => close(false)}>
              Cancel
            </button>
            <button
              type="button"
              className={`btn ${options?.danger ? "btn-danger" : "btn-primary"}`}
              onClick={() => close(true)}
            >
              {options?.confirmLabel ?? "Confirm"}
            </button>
          </div>
        </div>
      </dialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): Confirm {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error("useConfirm must be used inside <ConfirmProvider>");
  return confirm;
}
