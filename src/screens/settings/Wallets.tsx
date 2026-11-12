import { type FormEvent, useState } from "react";
import { useVault } from "../../app/vault";
import { type WalletRecord, walletDescriptor } from "../../core/wallets";
import { qrPath } from "../../transport/qr";
import { Button, Field, inputClass, LinkButton, linkClass, Panel } from "../../ui/kit";
import { Sheet } from "../../ui/sheet";
import { useToast } from "../../ui/toast";
import { formatDescriptor } from "../../wallet/descriptor";
import { DescriptorBackup } from "../import/DescriptorBackup";

export function Wallets() {
  const { wallets, renameWallet, renameWalletGroup, removeWallet } = useVault();
  const toast = useToast();
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [groupEditing, setGroupEditing] = useState(false);
  const [removing, setRemoving] = useState<WalletRecord | null>(null);
  const [showing, setShowing] = useState<WalletRecord | null>(null);
  const parsed = showing && walletDescriptor(showing);
  const descriptor = parsed && formatDescriptor(parsed);
  const qr = descriptor && qrPath(descriptor, "medium");

  const rename = async (event: FormEvent) => {
    event.preventDefault();
    await (groupEditing ? renameWalletGroup : renameWallet)(editing!, name.trim());
    setEditing(null);
  };
  const remove = async () => {
    await removeWallet(removing!.id);
    toast(`${removing!.name} removed`);
    setRemoving(null);
  };

  return (
    <Panel title="Wallets" aside={`${wallets.length} in this vault`}>
      <p className="m-0 text-sm text-ink-2">
        Each account has its own descriptor, balance and coins. A send spends from one account.
      </p>
      <ul className="m-0 grid list-none gap-2 p-0">
        {wallets.map((w) =>
          editing === w.id ? (
            <li key={w.id}>
              <form onSubmit={rename} className="flex flex-wrap items-end gap-2">
                <div className="min-w-0 flex-1">
                  <Field label={`New name for ${w.name}`}>
                    {(props) => (
                      <input
                        {...props}
                        className={inputClass}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        autoComplete="off"
                        autoFocus
                      />
                    )}
                  </Field>
                </div>
                <Button type="submit" variant="primary" disabled={!name.trim()}>
                  Save
                </Button>
                <Button onClick={() => setEditing(null)}>Cancel</Button>
              </form>
            </li>
          ) : (
            <li key={w.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
              <span className="min-w-0 basis-full font-medium break-words">
                {w.group ? `${w.group.name} / ${w.name}` : w.name}
              </span>
              <span className="text-ink-3">{w.network}</span>
              <LinkButton
                aria-label={`Rename ${w.name}`}
                onClick={() => {
                  setGroupEditing(false);
                  setName(w.name);
                  setEditing(w.id);
                }}
              >
                Rename
              </LinkButton>
              {w.group && (
                <LinkButton
                  aria-label={`Rename wallet ${w.group.name}`}
                  onClick={() => {
                    setGroupEditing(true);
                    setName(w.group!.name);
                    setEditing(w.id);
                  }}
                >
                  Rename wallet
                </LinkButton>
              )}
              <LinkButton aria-label={`Descriptor of ${w.name}`} onClick={() => setShowing(w)}>
                Descriptor
              </LinkButton>
              <LinkButton aria-label={`Remove ${w.name}`} onClick={() => setRemoving(w)} className="text-bad!">
                Remove
              </LinkButton>
            </li>
          ),
        )}
      </ul>
      <a className={linkClass} href="#/import">
        Add a wallet
      </a>
      <Sheet
        open={!!showing}
        onClose={() => setShowing(null)}
        title={`Descriptor of ${showing?.name ?? "this wallet"}`}
      >
        {showing && descriptor && qr && (
          <>
            <div className="grid justify-items-center rounded-panel border border-rule bg-qr p-4">
              <svg
                viewBox={`0 0 ${qr.size} ${qr.size}`}
                role="img"
                aria-label={`QR code of the descriptor of ${showing.name}`}
                shapeRendering="crispEdges"
                className="aspect-square w-full max-w-[360px]"
              >
                <path d={qr.d} className="fill-qr-ink" />
              </svg>
            </div>
            <DescriptorBackup name={showing.name} network={showing.network} descriptor={descriptor} />
            <p className="m-0 text-sm text-ink-3">
              It holds no keys: someone who sees it can see your balance and history, but can't spend.
            </p>
            {parsed?.multi && (
              <p className="m-0 text-sm text-ink-2">
                Scan it into each cosigner's signer. Until a signer holds it, it can't tell your change from a payment,
                so a tampered page could send change to someone else's multisig.
              </p>
            )}
          </>
        )}
      </Sheet>
      <Sheet open={!!removing} onClose={() => setRemoving(null)} title={`Remove ${removing?.name ?? "this wallet"}`}>
        <div className="grid gap-3 text-ink-2">
          <p className="m-0">
            This removes this account from this browser, with its history, labels and frozen coins. Your coins aren't
            affected.
          </p>
          <p className="m-0">To see it here again you'll need its descriptor. Labels you haven't exported are lost.</p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={() => setRemoving(null)}>Keep it</Button>
          <Button variant="danger" onClick={remove}>
            {removing?.group ? "Remove the account" : "Remove the wallet"}
          </Button>
        </div>
      </Sheet>
    </Panel>
  );
}
