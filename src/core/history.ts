import type { WalletTx } from "./view";

export const isOutgoing = (tx: WalletTx) => tx.inputs.some((i) => i.mine);

/** Unix seconds: block time, else when first seen. */
export const txWhen = (tx: WalletTx) => tx.time ?? (tx.seenAt === null ? null : Math.floor(tx.seenAt / 1000));

export const feeRate = (tx: Pick<WalletTx, "fee" | "vsize">) =>
  tx.fee === null ? null : Math.round((tx.fee / tx.vsize) * 10) / 10;

export const txDirection = (tx: WalletTx) =>
  !isOutgoing(tx) ? "received" : tx.outputs.every((o) => o.mine) ? "to self" : "sent";

const csvField = (value: string | number | null) => {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** The history as CSV. The fee is filled in only where this wallet paid it. */
export function historyCsv(transactions: WalletTx[]) {
  const btc = (sats: number | null) => (sats === null ? null : (sats / 1e8).toFixed(8));
  const rows = transactions.map((tx) => {
    const when = txWhen(tx);
    const fee = isOutgoing(tx) ? tx.fee : null;
    return [
      when === null ? null : new Date(when * 1000).toISOString(),
      tx.txid,
      txDirection(tx),
      btc(tx.net),
      tx.net,
      btc(fee),
      fee,
      tx.confirmations,
      tx.height,
      // A spreadsheet runs a cell starting with = + - @ as a formula, and labels can come from an imported file.
      tx.label && /^[=+\-@]/.test(tx.label) ? `'${tx.label}` : tx.label,
    ];
  });
  const head = [
    "date",
    "txid",
    "direction",
    "net_btc",
    "net_sats",
    "fee_btc",
    "fee_sats",
    "confirmations",
    "height",
    "label",
  ];
  return `${[head, ...rows].map((r) => r.map(csvField).join(",")).join("\r\n")}\r\n`;
}
