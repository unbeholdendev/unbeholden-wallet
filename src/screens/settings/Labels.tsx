import { useState } from "react";
import { useWalletSession, useWalletSnapshot } from "../../app/session";
import { useVault } from "../../app/vault";
import { historyCsv } from "../../core/history";
import { Icon } from "../../ui/icons";
import { Button, buttonClass, Notice, Panel } from "../../ui/kit";
import { download } from "../Backup";

export function Labels() {
  const session = useWalletSession();
  const snapshot = useWalletSnapshot();
  const { wallets, walletId } = useVault();
  const [report, setReport] = useState<string | null>(null);
  const name = wallets.find((w) => w.id === walletId)?.name ?? "wallet";

  const save = (body: string, type: string, suffix: string) =>
    download(body, type, `${name.replace(/[^\w-]+/g, "-")}-${suffix}`);
  const importLabels = async (file: File | undefined) => {
    if (!file || !session) return;
    const { imported, skipped } = await session.importLabels(await file.text());
    setReport(
      `Imported ${imported === 1 ? "1 label" : `${imported} labels`}` +
        (skipped ? `, skipped ${skipped} that were unreadable or belong to another wallet.` : "."),
    );
  };

  return (
    <Panel title="Labels and history" aside={name}>
      <p className="m-0 text-sm text-ink-2">
        Labels and frozen coins, as a BIP329 file that Sparrow and other wallets read. Importing adds to the labels here
        and replaces any for the same thing.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          icon="download"
          disabled={!session}
          onClick={() => save(session!.exportLabels(), "application/jsonl", "labels.jsonl")}
        >
          Export labels
        </Button>
        <label className={`${buttonClass({})} cursor-pointer has-disabled:cursor-not-allowed`}>
          <Icon name="upload" />
          Import labels
          <input
            type="file"
            accept=".jsonl,.json,.txt,application/jsonl,application/json,text/plain"
            disabled={!session}
            className="sr-only"
            onChange={(e) => {
              void importLabels(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      {report && <Notice tone="ok">{report}</Notice>}
      <p className="m-0 border-t border-rule pt-3 text-sm text-ink-2">
        Every transaction as a spreadsheet: date, txid, direction, amount and fee in BTC and sats, confirmations and
        label.
      </p>
      <Button
        icon="download"
        className="justify-self-start"
        disabled={!snapshot}
        onClick={() => save(historyCsv(snapshot!.transactions), "text/csv", "history.csv")}
      >
        Export history as CSV
      </Button>
    </Panel>
  );
}
