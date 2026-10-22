import { useRef, useState, type ReactNode } from "react";
import { useOpenFailure, useWalletSession } from "../app/session";
import type { LabelType } from "../core/wallet";
import { Icon } from "../ui/icons";
import { Button, inputClass, linkClass, Notice } from "../ui/kit";
import { SourceTag, type Source } from "../ui/sources";
import { useToast } from "../ui/toast";
import { outpoint } from "../wallet/coin";

/** A label that turns into a text field on click. Enter or leaving the field saves; Escape cancels. */
export function EditableLabel({
  type,
  target,
  value,
  placeholder = "Add a label",
  className = "",
  children,
}: {
  type: LabelType;
  target: string;
  value: string | null;
  placeholder?: string;
  className?: string;
  /** Shown in place of the label text when not editing. */
  children?: ReactNode;
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
      className={`group inline-flex max-w-full min-w-0 items-baseline gap-1.5 rounded-check text-left ${value ? "text-ink" : "text-ink-3"} hover:text-carbon ${className}`}
    >
      {children ?? <span className="min-w-0 break-words">{value ?? placeholder}</span>}
      {value && <span className="sr-only">, edit label</span>}
      <Icon name="pencil" className="size-3.5 translate-y-0.5 text-ink-3 opacity-60 group-hover:text-carbon group-hover:opacity-100" />
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
  const failed = useOpenFailure();
  return (
    <div className="grid content-start gap-2">
      <h1 className="m-0 text-xl font-bold">{title}</h1>
      {failed ? (
        <>
          <Notice tone="bad">
            This wallet couldn't be opened. {failed.message}
          </Notice>
          <p className="m-0 text-ink-2">
            Try again. If it still fails, remove the wallet in <a href="#/settings" className={linkClass}>Settings</a> and add it again.
          </p>
          <Button className="justify-self-start" icon="retry" onClick={failed.retry}>
            Try again
          </Button>
        </>
      ) : (
        <p className="m-0 text-ink-3">Opening the wallet.</p>
      )}
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

/** A source's name, editable, what it is, and whether whoever paid it knows who the user is. */
export function SourceTitle({ source, on = false }: { source: Source; on?: boolean }) {
  const session = useWalletSession();
  return (
    <div className="grid min-w-0 justify-items-start gap-1">
      <EditableLabel type="output" target={outpoint(source.coins[0]!)} value={source.label} placeholder={source.name} className="relative z-[1] max-w-full">
        <SourceTag source={source} large on={on} />
      </EditableLabel>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-manila-ink">
        {source.note}
        <button
          type="button"
          role="switch"
          aria-checked={source.kyc.length > 0}
          onClick={() => (source.kyc.length ? session?.setKyc(source.kyc, false) : session?.setKyc(source.coins, true))}
          className="relative z-[1] inline-flex items-center gap-1 rounded-chip px-1.5 py-px font-medium text-ink-3 underline decoration-dotted underline-offset-2 hover:text-carbon aria-checked:bg-warn-tint aria-checked:text-warn aria-checked:no-underline"
        >
          {source.kyc.length > 0 && <Icon name="check" className="size-3" />}
          Knows who I am
        </button>
      </span>
    </div>
  );
}
