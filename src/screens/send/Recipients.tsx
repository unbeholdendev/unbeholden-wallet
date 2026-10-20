import { hex } from "@scure/base";
import { Address, OutScript } from "@scure/btc-signer";
import { useState } from "react";
import { Icon } from "../../ui/icons";
import type { Contact } from "../../core/wallets";
import { useUnit } from "../../app/vault";
import { Button, Field, inputClass, LinkButton, Panel } from "../../ui/kit";
import { QrScanner } from "../../ui/QrScanner";
import { Sheet } from "../../ui/sheet";
import { NETWORKS, type Network } from "../../wallet/network";

export type Draft = { key: number; address: string; amount: string; max: boolean; label: string };

const NAMES: Record<Network, string> = { mainnet: "mainnet", signet: "testnet or signet", regtest: "regtest", testnet3: "testnet or signet", testnet4: "testnet or signet" };

/** The output script and canonical spelling of an address on the wallet's network, or why there are none. */
export function checkAddress(text: string, network: Network): { script: string; address: string } | { error: string } {
  const address = text.trim();
  try {
    const decoded = Address(NETWORKS[network]).decode(address);
    return { script: hex.encode(OutScript.encode(decoded)), address: Address(NETWORKS[network]).encode(decoded) };
  } catch {}
  for (const other of Object.keys(NETWORKS) as Network[]) {
    try {
      if (other !== network && Address(NETWORKS[other]).decode(address))
        return { error: `This is a ${NAMES[other]} address, but this wallet is on ${network}.` };
    } catch {}
  }
  if (/^(bc|tb|bcrt)1/i.test(address))
    return { error: "This address has a mistake in it: its checksum does not match. Check every character." };
  return { error: "This is not a Bitcoin address." };
}

// 21 million BTC, well inside exact integer range.
const MAX_SATS = 21e14;

/** Sats from a BTC amount as typed, spaces allowed; null when it is not one. */
export function parseBtc(text: string): number | null {
  const m = /^(\d*)(?:\.(\d{0,8}))?$/.exec(text.replace(/[\s ]/g, ""));
  if (!m || (!m[1] && !m[2])) return null;
  const sats = Number(m[1] || 0) * 1e8 + Number((m[2] ?? "").padEnd(8, "0"));
  return sats <= MAX_SATS ? sats : null;
}

/** Sats from an amount as typed: BTC, or whole sats with a `sats` suffix. */
export function parseAmount(text: string): number | null {
  const m = /^(\d[\d\s]*)sats?$/i.exec(text.trim());
  if (!m) return parseBtc(text);
  const sats = Number(m[1]!.replace(/\s/g, ""));
  return sats <= MAX_SATS ? sats : null;
}

export const btcText = (sats: number) => (sats / 1e8).toFixed(8).replace(/\.?0+$/, "");

/** An address, or a BIP21 `bitcoin:` URI with its amount and label. */
// https://github.com/bitcoin/bips/blob/master/bip-0021.mediawiki
export function parseUri(text: string): { address: string; amount?: string; label?: string } {
  const m = /^bitcoin:([^?]*)(?:\?(.*))?$/i.exec(text.trim());
  if (!m) return { address: text.trim() };
  const query = new URLSearchParams(m[2] ?? "");
  // A required parameter this wallet does not know voids the URI, so it is left whole to fail as an address.
  if ([...query.keys()].some((k) => k.startsWith("req-"))) return { address: text.trim() };
  const amount = query.get("amount");
  return {
    address: m[1]!,
    ...(amount && parseBtc(amount) !== null && { amount }),
    ...((query.get("label") ?? query.get("message")) && { label: (query.get("label") ?? query.get("message"))! }),
  };
}

export function Recipients({
  drafts,
  onChange,
  network,
  own,
  maxAmounts,
  book,
  onSave,
}: {
  drafts: Draft[];
  onChange: (drafts: Draft[]) => void;
  network: Network;
  own: Set<string>;
  /** What each `max` recipient works out at, by index. */
  maxAmounts: number[];
  book: Contact[];
  onSave: (contact: Contact) => void;
}) {
  const [scanning, setScanning] = useState<number | null>(null);
  const [choosing, setChoosing] = useState<number | null>(null);
  const [saving, setSaving] = useState<{ address: string; name: string } | null>(null);
  const [noting, setNoting] = useState(new Set<number>());
  const sats = useUnit() === "sats";
  const shown = (text: string) => {
    const value = parseAmount(text);
    if (sats) return value?.toString() ?? text.replace(/\s*sats?$/i, "");
    return value !== null && /sats?$/i.test(text.trim()) ? btcText(value) : text;
  };
  const usable = book.filter((c) => "script" in checkAddress(c.address, network));
  const nameOf = new Map(book.map((c) => [c.address, c.name]));
  const update = (i: number, patch: Partial<Draft>) =>
    onChange(drafts.map((d, j) => (j === i ? { ...d, ...patch } : patch.max ? { ...d, max: false } : d)));

  return (
    <Panel title="Pay to">
      {drafts.map((draft, i) => {
        const check = draft.address.trim() ? checkAddress(draft.address, network) : null;
        const amount = parseAmount(draft.amount);
        const address = check && "address" in check ? check.address : draft.address.trim();
        const name = nameOf.get(address);
        return (
          <div key={draft.key} className={`grid gap-3 @min-[900px]:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] @min-[900px]:items-start ${i ? "border-t border-rule pt-3" : ""}`}>
            <Field
              label={drafts.length > 1 ? `Address ${i + 1}` : "Address"}
              error={check && "error" in check ? check.error : undefined}
              ok={check && "script" in check ? (own.has(address) ? `Valid ${network} address, and one of your own` : name ? `Valid ${network} address, saved as ${name}` : `Valid ${network} address`) : undefined}
            >
              {(props) => (
                <div className="flex gap-2">
                  <input
                    {...props}
                    className={`${inputClass} font-mono text-[0.86em]`}
                    value={draft.address}
                    spellCheck={false}
                    autoComplete="off"
                    autoCapitalize="off"
                    placeholder={network === "mainnet" ? "bc1q…" : network === "regtest" ? "bcrt1q…" : "tb1q…"}
                    onChange={(e) => {
                      const uri = parseUri(e.target.value);
                      update(i, uri.address === e.target.value.trim() ? { address: e.target.value } : { address: uri.address, amount: uri.amount ?? draft.amount, label: uri.label ?? draft.label });
                    }}
                  />
                  <button type="button" aria-label="Scan an address" onClick={() => setScanning(i)} className="grid min-h-11 w-11 flex-none place-items-center rounded-control border border-rule-2 bg-sheet text-ink-2 hover:bg-sunk">
                    <Icon name="scan" />
                  </button>
                  {usable.length > 0 && (
                    <button type="button" aria-label="Choose a saved address" onClick={() => setChoosing(i)} className="min-h-11 flex-none rounded-control border border-rule-2 bg-sheet px-3 text-sm font-bold text-ink-2 hover:bg-sunk">
                      Saved
                    </button>
                  )}
                  {drafts.length > 1 && (
                    <button type="button" aria-label={`Remove recipient ${i + 1}`} onClick={() => { setNoting(new Set([...noting].filter((k) => k !== draft.key))); onChange(drafts.filter((_, j) => j !== i)); }} className="grid min-h-11 w-11 flex-none place-items-center rounded-control text-ink-2 hover:bg-sunk hover:text-bad">
                      <Icon name="close" />
                    </button>
                  )}
                </div>
              )}
            </Field>
            <Field
              label={sats ? "Amount, sats" : "Amount, BTC"}
              error={!draft.max && draft.amount && amount === null ? (sats ? "Write it as whole sats, like 5000." : "Write it as BTC with up to eight decimals.") : undefined}
              hint={draft.max ? "Everything in the selected coins, less the fee" : undefined}
            >
              {(props) => (
                <div className="flex gap-2">
                  <input
                    {...props}
                    className={`${inputClass} tabular-nums disabled:bg-sunk disabled:text-ink-2`}
                    inputMode={sats ? "numeric" : "decimal"}
                    autoComplete="off"
                    disabled={draft.max}
                    value={draft.max ? (sats ? String(maxAmounts[i] ?? 0) : btcText(maxAmounts[i] ?? 0)) : shown(draft.amount)}
                    placeholder={sats ? "0" : "0.00"}
                    onChange={(e) => update(i, { amount: sats && e.target.value.trim() ? `${e.target.value} sats` : e.target.value })}
                  />
                  <button
                    type="button"
                    aria-pressed={draft.max}
                    onClick={() => update(i, { max: !draft.max })}
                    className="min-h-11 flex-none rounded-control border border-rule-2 bg-sheet px-3 text-sm font-bold text-ink-2 hover:bg-sunk aria-pressed:border-carbon aria-pressed:bg-carbon aria-pressed:text-carbon-ink"
                  >
                    Max
                  </button>
                </div>
              )}
            </Field>
            {draft.label || noting.has(draft.key) ? (
              <div className="@min-[900px]:col-span-2">
                <Field label="Note">
                  {(props) => <input {...props} className={inputClass} value={draft.label} placeholder="Only you see this" autoFocus={!draft.label} onChange={(e) => { setNoting(new Set(noting).add(draft.key)); update(i, { label: e.target.value }); }} />}
                </Field>
              </div>
            ) : (
              check && "script" in check && (
                <LinkButton className="justify-self-start text-sm" onClick={() => setNoting(new Set(noting).add(draft.key))}>
                  Add a note
                </LinkButton>
              )
            )}
            {check && "script" in check && !name && !own.has(address) && (
              <LinkButton className="justify-self-start text-sm" onClick={() => setSaving({ address, name: draft.label })}>
                Save to address book
              </LinkButton>
            )}
          </div>
        );
      })}
      <LinkButton className="flex items-center gap-1.5 justify-self-start" onClick={() => onChange([...drafts, { key: Math.max(...drafts.map((d) => d.key)) + 1, address: "", amount: "", max: false, label: "" }])}>
        <Icon name="plus" className="size-4" /> Add another recipient
      </LinkButton>
      <Sheet open={choosing !== null} onClose={() => setChoosing(null)} title="Choose a saved address">
        <ul className="m-0 grid list-none gap-2 p-0">
          {usable.map((c) => (
            <li key={c.address}>
              <button
                type="button"
                onClick={() => {
                  update(choosing!, { address: c.address });
                  setChoosing(null);
                }}
                className="grid w-full gap-0.5 rounded-control border border-rule-2 px-3 py-2.5 text-left hover:bg-sunk"
              >
                <span className="font-medium">{c.name}</span>
                <span className="font-mono text-xs break-all text-ink-3">{c.address}</span>
              </button>
            </li>
          ))}
        </ul>
      </Sheet>
      <Sheet open={!!saving} onClose={() => setSaving(null)} title="Save to address book">
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            onSave({ address: saving!.address, name: saving!.name.trim() });
            setSaving(null);
          }}
        >
          <p className="m-0 font-mono text-[0.86em] break-all text-ink-2">{saving?.address}</p>
          <Field label="Name">
            {(props) => <input {...props} className={inputClass} value={saving?.name ?? ""} autoComplete="off" autoFocus onChange={(e) => setSaving({ ...saving!, name: e.target.value })} />}
          </Field>
          <Button type="submit" variant="primary" className="justify-self-start" disabled={!saving?.name.trim()}>
            Save
          </Button>
        </form>
      </Sheet>
      <Sheet open={scanning !== null} onClose={() => setScanning(null)} title="Scan an address">
        <p className="m-0 text-sm text-ink-2">Point the camera at an address or a payment request QR code. An amount and label in the request fill in too.</p>
        {scanning !== null && (
          <QrScanner
            onResult={(text) => {
              const uri = parseUri(text);
              const at = scanning;
              setScanning(null);
              update(at, { address: uri.address, amount: uri.amount ?? drafts[at]!.amount, label: uri.label ?? drafts[at]!.label });
            }}
          />
        )}
      </Sheet>
    </Panel>
  );
}
