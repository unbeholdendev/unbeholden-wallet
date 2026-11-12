import { hex } from "@scure/base";
import { RawTx } from "@scure/btc-signer";
import { useState } from "react";
import { checkAddress, NOT_AN_ADDRESS, parseUri } from "../screens/send/Recipients";
import { Icon } from "../ui/icons";
import { Button, inputClass } from "../ui/kit";
import { QrScanner } from "../ui/QrScanner";
import { Sheet } from "../ui/sheet";
import type { Network } from "../wallet/network";
import { navigate } from "./route";
import { useNetwork } from "./session";

export type SearchResult = { route: string } | { error: string };

function isRawTx(text: string) {
  try {
    RawTx.decode(hex.decode(text));
    return true;
  } catch {
    return false;
  }
}

/** Where a search for this text goes, or why it goes nowhere. */
export function parseSearch(text: string, network: Network): SearchResult {
  const query = text.trim();
  if (/^[0-9a-f]{64}$/i.test(query)) return { route: `/tx/${query.toLowerCase()}` };
  if (/^\d[\d\s]*$/.test(query)) return { route: `/block/${Number(query.replace(/\s/g, ""))}` };
  if (/^([0-9a-f]{2})+$/i.test(query) && isRawTx(query)) return { route: `/broadcast/${query.toLowerCase()}` };
  const address = checkAddress(parseUri(query).address, network);
  if ("address" in address) return { route: `/address/${address.address}` };
  return {
    error:
      address.error === NOT_AN_ADDRESS
        ? "Search takes a transaction ID, an address, a block height or a raw transaction in hex."
        : address.error,
  };
}

function useSearch(onDone?: () => void) {
  const network = useNetwork();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = (value: string) => {
    const result = parseSearch(value, network);
    if ("error" in result) return setError(result.error);
    setText("");
    setError(null);
    navigate(result.route);
    onDone?.();
  };
  const input = {
    type: "search",
    "aria-label": "Search the chain",
    "aria-invalid": error !== null,
    placeholder: "Txid, address or height",
    autoComplete: "off",
    spellCheck: false,
    value: text,
    onChange: (e: { target: { value: string } }) => {
      setText(e.target.value);
      setError(null);
    },
  };
  return {
    input,
    error,
    submit: (e?: { preventDefault(): void }) => (e?.preventDefault(), submit(text)),
    scanned: submit,
  };
}

function SearchField() {
  const { input, error, submit } = useSearch();
  return (
    <form role="search" onSubmit={submit} className="relative hidden w-56 flex-none @min-[1024px]/app:block">
      <Icon name="search" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
      <input
        {...input}
        className="h-10 w-full rounded-control border border-rule-2 bg-sheet pr-3 pl-9 text-sm text-ink caret-carbon placeholder:text-ink-3 focus:border-transparent focus:outline-2 focus:-outline-offset-1 focus:outline-carbon"
      />
      {error && (
        <p
          role="alert"
          className="absolute top-[calc(100%+6px)] right-0 z-20 m-0 w-80 rounded-panel border border-rule-2 bg-sheet p-3 text-sm text-ink shadow-float"
        >
          {error}
        </p>
      )}
    </form>
  );
}

function SearchSheet() {
  const [open, setOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const close = () => {
    setOpen(false);
    setScanning(false);
  };
  const { input, error, submit, scanned } = useSearch(close);
  return (
    <>
      <button
        type="button"
        aria-label="Search the chain"
        onClick={() => setOpen(true)}
        className="grid size-10 flex-none place-items-center rounded-control border border-rule-2 bg-sheet text-ink hover:bg-sunk @min-[1024px]/app:hidden"
      >
        <Icon name="search" />
      </button>
      <Sheet open={open} onClose={close} title="Search">
        <form role="search" onSubmit={submit} className="grid gap-3">
          <input {...input} autoFocus className={inputClass} />
          {error && (
            <p role="alert" className="m-0 text-sm text-bad">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary">
              Search
            </Button>
            <Button icon="scan" onClick={() => setScanning(!scanning)}>
              {scanning ? "Stop scanning" : "Scan a QR code"}
            </Button>
          </div>
        </form>
        {scanning && <QrScanner onResult={scanned} />}
      </Sheet>
    </>
  );
}

/** A search field in the top bar, or on a phone an icon that opens one in a sheet with a QR scanner. */
export function Search() {
  return (
    <>
      <SearchField />
      <SearchSheet />
    </>
  );
}
