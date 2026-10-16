import { hex } from "@scure/base";
import { HDKey } from "@scure/bip32";
import { Transaction } from "@scure/btc-signer";
import { p2tr, p2wpkh } from "@scure/btc-signer/payment.js";
import {
  formatDescriptor,
  type Descriptor,
  type ScriptType,
} from "../../src/wallet/descriptor";
import { deriveAddress, derivePublicKey } from "../../src/wallet/derive";
import { BIP32_VERSIONS } from "../../src/wallet/extended-key";
import { NETWORKS } from "../../src/wallet/network";

export const ELECTRUM_WS = "ws://127.0.0.1:50003";
export const ELECTRUM_WSS = "wss://127.0.0.1:50004";
export const BITCOIND_RPC = "http://127.0.0.1:18443";

const AUTH = `Basic ${btoa("regtest:regtest")}`;
const H = 0x80000000;
const FEE = 1_000n;

type Call = [method: string, ...params: unknown[]];

/** Calls bitcoind, as the `miner` wallet up.sh creates. */
export async function rpcBatch(calls: Call[]): Promise<any[]> {
  const response = await fetch(`${BITCOIND_RPC}/wallet/miner`, {
    method: "POST",
    headers: { authorization: AUTH },
    body: JSON.stringify(
      calls.map(([method, ...params], id) => ({ jsonrpc: "2.0", id, method, params })),
    ),
  });
  const replies = (await response.json()) as { result: unknown; error: { message: string } | null }[];
  return replies.map(({ result, error }) => {
    if (error) throw new Error(error.message);
    return result;
  });
}

export async function rpc(method: string, ...params: unknown[]): Promise<any> {
  return (await rpcBatch([[method, ...params]]))[0];
}

// Private keys exist only here, in fixture code.
const master = HDKey.fromMasterSeed(
  hex.decode("000102030405060708090a0b0c0d0e0f"),
  BIP32_VERSIONS.regtest,
);

export type TestWallet = {
  descriptor: Descriptor;
  /** With its checksum, ready to import. */
  text: string;
  account: HDKey;
};

function testWallet(scriptType: ScriptType, purpose: number, account: number): TestWallet {
  const path = [purpose + H, 1 + H, account + H];
  const node = master.derive(`m/${purpose}'/1'/${account}'`);
  const descriptor: Descriptor = {
    scriptType,
    origin: { fingerprint: master.fingerprint.toString(16).padStart(8, "0"), path },
    key: node.publicExtendedKey,
    path: [[0, 1], "*"],
  };
  return { descriptor, text: formatDescriptor(descriptor), account: node };
}

export const BIP84 = testWallet("wpkh", 84, 0);
export const BIP86 = testWallet("tr", 86, 0);
/** Holds the large history the performance spec syncs. */
export const LARGE = testWallet("wpkh", 84, 1);
const FAUCET = testWallet("wpkh", 84, 2);

export function address(wallet: TestWallet, chain: number, index: number): string {
  return deriveAddress(wallet.descriptor, "regtest", chain, index);
}

export function script(wallet: TestWallet, chain: number, index: number): Uint8Array {
  const key = derivePublicKey(wallet.descriptor, "regtest", chain, index);
  return wallet.descriptor.scriptType === "wpkh"
    ? p2wpkh(key, NETWORKS.regtest).script
    : p2tr(key.slice(1), undefined, NETWORKS.regtest).script;
}

export async function mine(blocks = 1): Promise<string[]> {
  return rpc("generatetoaddress", blocks, await rpc("getnewaddress"));
}

type Coin = { txid: string; vout: number; amount: bigint; wallet: TestWallet; chain: number; index: number };

/** The output of `txid` that pays the wallet at this chain and index. */
export async function coin(txid: string, wallet: TestWallet, chain: number, index: number): Promise<Coin> {
  const tx = await rpc("getrawtransaction", txid, true);
  const wanted = hex.encode(script(wallet, chain, index));
  const output = tx.vout.find((out: any) => out.scriptPubKey.hex === wanted);
  return {
    txid,
    vout: output.n,
    amount: BigInt(Math.round(output.value * 1e8)),
    wallet,
    chain,
    index,
  };
}

/** Signs a spend of the wallet's coins and hands it to bitcoind. */
export async function spend(coins: Coin[], outputs: Output[]): Promise<string> {
  return rpc("sendrawtransaction", sign(coins, outputs).hex);
}

type Output = { address: string; amount: bigint };

export function sign(coins: Coin[], outputs: Output[]): Transaction {
  const tx = new Transaction();
  for (const { txid, vout, amount, wallet, chain, index } of coins) {
    const witnessUtxo = { script: script(wallet, chain, index), amount };
    const key = derivePublicKey(wallet.descriptor, "regtest", chain, index);
    tx.addInput({
      txid,
      index: vout,
      witnessUtxo,
      sequence: 0xfffffffd,
      ...(wallet.descriptor.scriptType === "tr" && { tapInternalKey: key.slice(1) }),
    });
  }
  for (const output of outputs) tx.addOutputAddress(output.address, output.amount, NETWORKS.regtest);
  coins.forEach(({ wallet, chain, index }, i) => {
    tx.signIdx(wallet.account.deriveChild(chain).deriveChild(index).privateKey!, i);
  });
  tx.finalize();
  return tx;
}

export type Fixture = {
  /** Every transaction that touches the test wallets. */
  txids: string[];
  /** Paid to BIP84 0/0, then spent by `confirmedSpend`. */
  spentFunding: string;
  /** Paid to BIP84 0/1, confirmed and never spent. */
  unspentFunding: string;
  confirmedSpend: string;
  unconfirmedChange: string;
  unconfirmedIncoming: string;
  unconfirmedParents: string;
};

/**
 * Builds a known history on top of up.sh's chain:
 * - confirmed coins to both wallets,
 * - a confirmed spend from the BIP84 wallet, with change,
 * - an unconfirmed spend from the BIP86 wallet, so unconfirmed change,
 * - an unconfirmed payment in from someone else,
 * - a payment in that spends an output which is itself unconfirmed.
 */
export async function buildFixture(): Promise<Fixture> {
  const other = await rpc("getnewaddress");
  const fundA = await rpc("sendtoaddress", address(BIP84, 0, 0), 1);
  const fundB = await rpc("sendtoaddress", address(BIP84, 0, 1), 0.5);
  const fundC = await rpc("sendtoaddress", address(BIP86, 0, 0), 0.7);
  await mine();

  const confirmedSpend = await spend(
    [await coin(fundA, BIP84, 0, 0)],
    [
      { address: other, amount: 30_000_000n },
      { address: address(BIP84, 1, 0), amount: 70_000_000n - FEE },
    ],
  );
  await mine();

  const unconfirmedChange = await spend(
    [await coin(fundC, BIP86, 0, 0)],
    [
      { address: other, amount: 20_000_000n },
      { address: address(BIP86, 1, 0), amount: 50_000_000n - FEE },
    ],
  );
  const unconfirmedIncoming = await rpc("sendtoaddress", address(BIP84, 0, 2), 0.1);

  const parent = await rpc("sendtoaddress", other, 5);
  const parentTx = await rpc("getrawtransaction", parent, true);
  const vout = parentTx.vout.find((out: any) => out.scriptPubKey.address === other).n;
  const { txid: unconfirmedParents } = await rpc(
    "send",
    [{ [address(BIP84, 0, 3)]: 0.25 }],
    null,
    "unset",
    null,
    { inputs: [{ txid: parent, vout }], add_inputs: false },
  );

  return {
    txids: [fundA, fundB, fundC, confirmedSpend, unconfirmedChange, unconfirmedIncoming, unconfirmedParents],
    spentFunding: fundA,
    unspentFunding: fundB,
    confirmedSpend,
    unconfirmedChange,
    unconfirmedIncoming,
    unconfirmedParents,
  };
}

/**
 * Pays `count` transactions to the LARGE wallet, two per receive address.
 * Signed here rather than by bitcoind's wallet, which is far slower at it.
 */
export async function buildLargeHistory(count = 500): Promise<void> {
  const payment = 100_000n;
  const funding = await rpc("sendtoaddress", address(FAUCET, 0, 0), 10);
  let source = await coin(funding, FAUCET, 0, 0);
  // Twenty to a block keeps each chain inside bitcoind's limit of 25
  // unconfirmed ancestors.
  for (let sent = 0; sent < count; sent += 20) {
    const calls: Call[] = [];
    for (let i = sent; i < Math.min(sent + 20, count); i++) {
      const change = source.amount - payment - FEE;
      const tx = sign(
        [source],
        [
          { address: address(LARGE, 0, Math.floor(i / 2)), amount: payment },
          { address: address(FAUCET, 0, 0), amount: change },
        ],
      );
      calls.push(["sendrawtransaction", tx.hex]);
      source = { ...source, txid: tx.id, vout: 1, amount: change };
    }
    await rpcBatch(calls);
    await mine();
  }
}

/** Replaces the top `depth` blocks with `depth + 1` new ones. */
export async function reorg(depth = 1): Promise<void> {
  const height = await rpc("getblockcount");
  await rpc("invalidateblock", await rpc("getblockhash", height - depth + 1));
  await mine(depth + 1);
}
