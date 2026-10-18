import { hex } from "@scure/base";
import { RawTx } from "@scure/btc-signer";
import type { HistoryEntry } from "../backend/backend";
import { outpoint, type Coin, type CoinStatus } from "../wallet/coin";
import { childPath, formatIndex, type Descriptor } from "../wallet/descriptor";
import { linkCoins, type HistoryTx } from "../wallet/privacy";

export type AddressInfo = {
  address: string;
  /** 0 receive, 1 change. */
  chain: number;
  index: number;
  /** From the master key when the descriptor gives a key origin, else from the key. */
  path: string;
  used: boolean;
  txCount: number;
  /** Paid by more than one transaction. */
  reused: boolean;
  label: string | null;
};

type Endpoint = {
  /** Null for an input whose previous transaction the server did not give. */
  value: number | null;
  address: string | null;
  /** Set when the wallet's descriptor owns the script. */
  mine: AddressInfo | null;
};

export type TxInput = Endpoint & { txid: string; vout: number };
export type TxOutput = Endpoint & { vout: number; script: string; label: string | null };

export type WalletTx = {
  txid: string;
  height: number | null;
  confirmations: number;
  /** Block time, unix seconds. */
  time: number | null;
  /** When this wallet first saw it unconfirmed, by the injected clock. */
  seenAt: number | null;
  /** Into the wallet, negative when sats left it. */
  net: number;
  /** Null when an input's value is unknown, as for a coinbase. */
  fee: number | null;
  vsize: number;
  inputs: TxInput[];
  outputs: TxOutput[];
  label: string | null;
};

export type WalletCoin = Coin & { label: string | null };

/**
 * Sats. `confirmed` and `unconfirmed` cover every coin, frozen or not.
 * `spendable` is what automatic selection may use: confirmed and own change, not frozen.
 */
export type Balance = { confirmed: number; unconfirmed: number; frozen: number; spendable: number };

/** What the wallet persists of the chain between visits. */
export type Cache = {
  tip: { height: number; header: string } | null;
  /** Per chain, so a return visit need not derive them again. */
  addresses: string[][];
  /** By scripthash; unused scripthashes are left out. */
  histories: Record<string, HistoryEntry[]>;
  /** Block time by height. */
  times: Record<string, number>;
  seen: Record<string, number>;
};

export type Parsed = HistoryTx & { vsize: number };

export type ViewSource = {
  descriptor: Descriptor;
  cache: Cache;
  labels: Record<string, string>;
  frozen: Set<string>;
  parsed: (txid: string) => Parsed | undefined;
  scriptOf: (address: string) => { script: string; hash: string };
  addressOf: (script: string) => string | null;
};

export type View = ReturnType<typeof deriveView>;

export const COINBASE = "00".repeat(32);

// Timestamp field of the block header.
// https://developer.bitcoin.org/reference/block_chain.html
export const blockTime = (header: Uint8Array) =>
  new DataView(header.buffer, header.byteOffset).getUint32(68, true);

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

function pathOf(descriptor: Descriptor, chain: number, index: number): string {
  const steps = [...(descriptor.origin?.path ?? []), ...childPath(descriptor, chain, index)].map(formatIndex);
  return (descriptor.origin ? "m/" : "") + steps.join("/");
}

export function parseTx(txid: string, bytes: Uint8Array): Parsed {
  const tx = RawTx.decode(bytes);
  const base = RawTx.encode({ ...tx, segwitFlag: false, witnesses: undefined }).length;
  return {
    txid,
    inputs: tx.inputs.map((i) => ({ txid: hex.encode(i.txid), vout: i.index })),
    outputs: tx.outputs.map((o) => ({ script: hex.encode(o.script), value: Number(o.amount) })),
    // Weight is three times the size without witnesses plus the full size.
    // https://github.com/bitcoin/bips/blob/master/bip-0141.mediawiki
    vsize: Math.ceil((base * 3 + bytes.length) / 4),
  };
}

export const emptyCache = (addresses: string[][]): Cache => ({
  tip: null,
  addresses,
  histories: {},
  times: {},
  seen: {},
});

/** Index of the last address on `chain` with any history, or -1. */
export const lastUsed = ({ cache, scriptOf }: Pick<ViewSource, "cache" | "scriptOf">, chain: number) =>
  cache.addresses[chain]!.findLastIndex((a) => cache.histories[scriptOf(a).hash]);

/** Balance, history, addresses and coins, worked out from the cached chain data alone. */
export function deriveView(source: ViewSource) {
  const { descriptor, cache, labels, frozen, parsed, scriptOf, addressOf } = source;
  const entries = new Map<string, HistoryEntry>();
  for (const list of Object.values(cache.histories)) {
    for (const entry of list) entries.set(entry.txid, entry);
  }
  const own = new Map<string, AddressInfo>();
  const addresses = cache.addresses.map((list, chain) =>
    list.map((address, index) => {
      const { script, hash } = scriptOf(address);
      const txCount = cache.histories[hash]?.length ?? 0;
      const info: AddressInfo = {
        address,
        chain,
        index,
        path: pathOf(descriptor, chain, index),
        used: txCount > 0,
        txCount,
        reused: false,
        label: labels[`addr:${address}`] ?? null,
      };
      own.set(script, info);
      return info;
    }),
  );

  const txs = [...entries.keys()].flatMap((txid) => parsed(txid) ?? []);
  const paidTo = new Map<string, number>();
  const spent = new Set<string>();
  for (const tx of txs) {
    for (const script of new Set(tx.outputs.map((o) => o.script))) {
      paidTo.set(script, (paidTo.get(script) ?? 0) + 1);
    }
    for (const input of tx.inputs) spent.add(outpoint(input));
  }
  for (const [script, count] of paidTo) {
    const info = own.get(script);
    if (info && count > 1) info.reused = true;
  }

  const prevout = (input: { txid: string; vout: number }) =>
    parsed(input.txid)?.outputs[input.vout];
  const statuses = new Map<string, CoinStatus>();
  const statusOf = (txid: string): CoinStatus => {
    const known = statuses.get(txid);
    if (known) return known;
    const entry = entries.get(txid)!;
    let status: CoinStatus = "confirmed";
    if (entry.height === null) {
      let allOwn = true;
      let foreignParent = false;
      let badParent = false;
      for (const input of parsed(txid)!.inputs) {
        const parent = entries.get(input.txid);
        const mine = own.has(prevout(input)?.script ?? "");
        allOwn &&= mine;
        if (!parent) foreignParent = true;
        else if (parent.height === null && (!mine || statusOf(input.txid) !== "own-change")) {
          badParent = true;
        }
      }
      // The server flags an unconfirmed parent but not which, so a foreign one is assumed.
      status =
        badParent || (entry.unconfirmedParents && foreignParent)
          ? "unconfirmed-parents"
          : allOwn
            ? "own-change"
            : "foreign-unconfirmed";
    }
    statuses.set(txid, status);
    return status;
  };

  const coins: WalletCoin[] = txs.flatMap((tx) =>
    tx.outputs.flatMap((o, vout) => {
      const info = own.get(o.script);
      const point = `${tx.txid}:${vout}`;
      if (!info || spent.has(point)) return [];
      return [
        {
          txid: tx.txid,
          vout,
          value: o.value,
          script: o.script,
          address: info.address,
          chain: info.chain,
          index: info.index,
          height: entries.get(tx.txid)!.height,
          status: statusOf(tx.txid),
          frozen: frozen.has(point),
          label: labels[`output:${point}`] ?? null,
        },
      ];
    }),
  );

  const tip = cache.tip && {
    height: cache.tip.height,
    time: blockTime(hex.decode(cache.tip.header)),
  };
  const depths = new Map<string, number>();
  const depth = (tx: Parsed): number => {
    if (!depths.has(tx.txid)) {
      const height = entries.get(tx.txid)!.height;
      const parents = tx.inputs.flatMap((i) => {
        const p = entries.get(i.txid)?.height === height ? parsed(i.txid) : undefined;
        return p ? [depth(p)] : [];
      });
      depths.set(tx.txid, 1 + Math.max(0, ...parents));
    }
    return depths.get(tx.txid)!;
  };
  const order = (tx: Parsed) => entries.get(tx.txid)!.height ?? Infinity;
  const transactions: WalletTx[] = [...txs]
    .sort((a, b) => order(b) - order(a) || depth(b) - depth(a) || (a.txid < b.txid ? -1 : 1))
    .map((tx) => {
      const height = entries.get(tx.txid)!.height;
      const inputs = tx.inputs.map((input) => {
        const p = input.txid === COINBASE ? undefined : prevout(input);
        return {
          ...input,
          value: p?.value ?? null,
          address: p ? addressOf(p.script) : null,
          mine: (p && own.get(p.script)) ?? null,
        };
      });
      const outputs = tx.outputs.map((o, vout) => ({
        vout,
        script: o.script,
        value: o.value,
        address: addressOf(o.script),
        mine: own.get(o.script) ?? null,
        label: labels[`output:${tx.txid}:${vout}`] ?? null,
      }));
      const ownValue = (list: Endpoint[]) => sum(list.map((e) => (e.mine ? e.value! : 0)));
      const outTotal = sum(outputs.map((o) => o.value));
      return {
        txid: tx.txid,
        height,
        confirmations: height === null || !tip ? 0 : tip.height - height + 1,
        time: height === null ? null : (cache.times[height] ?? null),
        seenAt: cache.seen[tx.txid] ?? null,
        net: ownValue(outputs) - ownValue(inputs),
        fee: inputs.every((i) => i.value !== null)
          ? sum(inputs.map((i) => i.value!)) - outTotal
          : null,
        vsize: tx.vsize,
        inputs,
        outputs,
        label: labels[`tx:${tx.txid}`] ?? null,
      };
    });

  const [receive = [], change = []] = addresses;
  const total = (list: WalletCoin[]) => sum(list.map((c) => c.value));
  return {
    tip,
    balance: {
      confirmed: total(coins.filter((c) => c.status === "confirmed")),
      unconfirmed: total(coins.filter((c) => c.status !== "confirmed")),
      frozen: total(coins.filter((c) => c.frozen)),
      spendable: total(
        coins.filter(
          (c) => !c.frozen && (c.status === "confirmed" || c.status === "own-change"),
        ),
      ),
    },
    transactions,
    addresses: { receive, change },
    /** The receive address after the last used one. */
    nextReceive: receive[lastUsed(source, 0) + 1]!,
    coins,
    /** Outpoint to privacy group, from `linkCoins`. */
    groups: linkCoins(txs, new Set(own.keys())),
    own,
  };
}

/** Where change goes: the first unused change address, or the next receive one for a single-chain descriptor. */
export const nextChange = (view: Pick<View, "addresses" | "nextReceive">) =>
  view.addresses.change.find((a) => !a.used) ?? view.nextReceive;

export const isOutgoing = (tx: WalletTx) => tx.inputs.some((i) => i.mine);

/** Unix seconds: block time, else when first seen. */
export const txWhen = (tx: WalletTx) => tx.time ?? (tx.seenAt === null ? null : Math.floor(tx.seenAt / 1000));

export const feeRate = (tx: WalletTx) => (tx.fee === null ? null : Math.round((tx.fee / tx.vsize) * 10) / 10);
