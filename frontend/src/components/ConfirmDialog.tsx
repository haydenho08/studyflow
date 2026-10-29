import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  /** Destructive actions get a red confirm button. */
  danger?: boolean;
}

interface Choice<T extends string> {
  value: T;
  label: string;
  danger?: boolean;
}

interface ChooseOptions<T extends string> {
  title: string;
  message?: string;
  choices: Choice<T>[];
}

type Confirm = (options: ConfirmOptions) => Promise<boolean>;
/** Resolves to the chosen value, or null for Cancel. */
type Choose = <T extends string>(options: ChooseOptions<T>) => Promise<T | null>;

type ChooseAny = (options: ChooseOptions<string>) => Promise<string | null>;

const ConfirmContext = createContext<{ confirm: Confirm; choose: ChooseAny } | null>(null);

/**
 * An in-app replacement for window.confirm(): styled like the rest of the app, and built on the
 * native <dialog> element, so focus trapping, Escape-to-cancel and the backdrop come for free.
 *
 *   const confirm = useConfirm();
 *   if (await confirm({ title: "Delete EECS 2030?", danger: true })) remove();
 *
 * useChoose() is the same dialog with several answers ("Only this one" / "This and following").
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const resolveRef = useRef<((value: string | null) => void) | null>(null);
  const [options, setOptions] = useState<ChooseOptions<string> | null>(null);

  const choose = useCallback((next: ChooseOptions<string>) => {
    setOptions(next);
    dialogRef.current?.showModal();
    return new Promise<string | null>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  const confirm = useCallback<Confirm>(
    async ({ confirmLabel = "Confirm", danger, ...rest }) =>
      (await choose({ ...rest, choices: [{ value: "yes", label: confirmLabel, danger }] })) === "yes",
    [choose],
  );

  const value = useMemo(() => ({ confirm, choose }), [confirm, choose]);

  function close(answer: string | null) {
    dialogRef.current?.close();
    resolveRef.current?.(answer);
    resolveRef.current = null;
  }

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <dialog
        ref={dialogRef}
        // Room for "Cancel" plus two longer answers on one line.
        className={(options?.choices.length ?? 0) > 1 ? "dialog dialog-wide" : "dialog"}
        aria-labelledby="confirm-title"
        aria-describedby={options?.message ? "confirm-message" : undefined}
        // Escape (the native "cancel" event) counts as "no".
        onCancel={(e) => {
          e.preventDefault();
          close(null);
        }}
        // A click on the backdrop (outside the panel) also cancels.
        onClick={(e) => {
          if (e.target === e.currentTarget) close(null);
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
            <button type="button" className="btn btn-ghost" autoFocus onClick={() => close(null)}>
              Cancel
            </button>
            {options?.choices.map((choice) => (
              <button
                key={choice.value}
                type="button"
                className={`btn ${choice.danger ? "btn-danger" : "btn-primary"}`}
                onClick={() => close(choice.value)}
              >
                {choice.label}
              </button>
            ))}
          </div>
        </div>
      </dialog>
    </ConfirmContext.Provider>
  );
}

function useDialogs() {
  const dialogs = useContext(ConfirmContext);
  if (!dialogs) throw new Error("useConfirm must be used inside <ConfirmProvider>");
  return dialogs;
}

export function useConfirm(): Confirm {
  return useDialogs().confirm;
}

export function useChoose(): Choose {
  // Typed per call: the dialog only ever resolves to one of the given choices' values (or null).
  return useDialogs().choose as Choose;
}
