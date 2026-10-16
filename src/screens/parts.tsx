import { useRef, useState } from "react";
import { useWalletSession } from "../app/session";
import type { LabelType } from "../core/wallet";
import { Icon } from "../ui/icons";
import { Button, inputClass } from "../ui/kit";
import { useToast } from "../ui/toast";

/** A label that turns into a text field on click. Enter or leaving the field saves; Escape cancels. */
export function EditableLabel({
  type,
  target,
  value,
  placeholder = "Add a label",
  className = "",
}: {
  type: LabelType;
  target: string;
  value: string | null;
  placeholder?: string;
  className?: string;
}) {
  const session = useWalletSession();
  const [draft, setDraft] = useState<string | null>(null);
  const editing = useRef(false);

  const edit = (text: string | null) => {
    editing.current = text !== null;
    setDraft(text);
  };
  const save = (text: string) => {
    if (!editing.current) return;
    edit(null);
    if (text.trim() !== (value ?? "")) void session?.setLabel(type, target, text.trim() || null);
  };

  if (draft !== null)
    return (
      <input
        autoFocus
        aria-label="Label"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => save(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save(e.currentTarget.value);
          if (e.key === "Escape") edit(null);
        }}
        className={`${inputClass} min-h-9 py-1.5 ${className}`}
      />
    );
  return (
    <button
      type="button"
      onClick={() => edit(value ?? "")}
      className={`group inline-flex max-w-full min-w-0 items-baseline gap-1.5 rounded-check text-left ${value ? "text-ink" : "text-ink-3"} hover:text-route ${className}`}
    >
      <span className="min-w-0 break-words">{value ?? placeholder}</span>
      {value && <span className="sr-only">, edit label</span>}
      <Icon name="pencil" className="size-3.5 translate-y-0.5 text-ink-3 opacity-60 group-hover:text-route group-hover:opacity-100" />
    </button>
  );
}

/** An address in groups of four, to read against a signer's screen; copies without the gaps. */
export function GroupedAddress({ address, className = "" }: { address: string; className?: string }) {
  return (
    <span className={`min-w-0 font-mono ${className}`}>
      {address.match(/.{1,4}/g)!.map((chunk, i) => (
        <span key={i} className="mr-[0.45ch] inline-block">
          {chunk}
        </span>
      ))}
    </span>
  );
}

/** Stands in for a wallet screen while the session opens. */
export function Opening({ title }: { title: string }) {
  return (
    <div className="grid content-start gap-2">
      <h1 className="m-0 text-xl font-semibold">{title}</h1>
      <p className="m-0 text-ink-3">Opening the wallet.</p>
    </div>
  );
}

export function CopyButton({ text, what }: { text: string; what: string }) {
  const toast = useToast();
  return (
    <Button
      size="sm"
      icon="copy"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        toast(`${what} copied`);
      }}
    >
      Copy
    </Button>
  );
}
