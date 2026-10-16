import { useEffect, useRef, type ReactNode } from "react";
import { Icon } from "./icons";

/** A modal dialog: a bottom sheet on a phone, a centred panel on a desk. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-label={title}
      className="m-0 mt-auto w-full max-w-none rounded-t-panel border border-rule-2 bg-sheet p-0 text-ink shadow-float backdrop:bg-[rgb(11_18_21/0.5)] min-[720px]:m-auto min-[720px]:max-w-[480px] min-[720px]:rounded-panel"
    >
      {open && (
        <div className="grid gap-4 p-4 pb-[calc(16px+env(safe-area-inset-bottom))] min-[720px]:p-6">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-lg font-semibold">{title}</h2>
            <button type="button" onClick={onClose} aria-label="Close" className="-m-1.5 grid size-9 place-items-center rounded-control text-ink-2 hover:bg-sunk">
              <Icon name="close" />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
