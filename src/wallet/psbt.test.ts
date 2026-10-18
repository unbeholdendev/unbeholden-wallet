import { base64, hex } from "@scure/base";
import { HDKey } from "@scure/bip32";
import { Address, NETWORK, OutScript, SigHash, TEST_NETWORK, Transaction } from "@scure/btc-signer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { INVALID, VALID } from "./bip174-vectors";
import type { Coin } from "./coin";
import { descriptorFromExtendedKey, parseDescriptor } from "./descriptor";
import { buildPsbt, finaliseSigned, parsePsbt, reviewPsbt } from "./psbt";
import { asVersion, BIP84_ZPUB, BIP86_XPUB, VERSION } from "./vectors";

describe("BIP174 vectors", () => {
  it.each(INVALID)("refuses: %s", (_, psbt) => {
    expect(() => parsePsbt(base64.decode(psbt))).toThrow("not a valid PSBT");
  });

  // These carry a redeemScript that does not hash to the input's script.
  // BIP174 lets a parser accept them; this wallet refuses anything a signer
  // could be misled by.
  const mismatched = (name: string) => name.startsWith("redeemScript with");

  it.each(VALID.filter(([name]) => !mismatched(name)))(
    "round-trips: %s",
    (_, psbt) => {
      expect(base64.encode(parsePsbt(base64.decode(psbt)).toPSBT())).toBe(psbt);
    },
  );

  it.each(VALID.filter(([name]) => mismatched(name)))(
    "refuses an inconsistent script: %s",
    (_, psbt) => {
      expect(() => parsePsbt(base64.decode(psbt))).toThrow();
    },
  );
});

// Root keys and addresses from the BIP84 and BIP86 test vectors. The private
// keys exist only so the tests can play the signer.
// https://github.com/bitcoin/bips/blob/master/bip-0084.mediawiki
// https://github.com/bitcoin/bips/blob/master/bip-0086.mediawiki
const BIP84 = {
  rootpriv:
    "zprvAWgYBBk7JR8Gjrh4UJQ2uJdG1r3WNRRfURiABBE3RvMXYSrRJL62XuezvGdPvG6GFBZduosCc1YP5wixPox7zhZLfiUm8aunE96BBa4Kei5",
  accountpriv:
    "zprvAdG4iTXWBoARxkkzNpNh8r6Qag3irQB8PzEMkAFeTRXxHpbF9z4QgEvBRmfvqWvGp42t42nvgGpNgYSJA9iefm1yYNZKEm7z6qUWCroSQnE",
  receive0: "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu",
  receive1: "bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g",
  change0: "bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el",
};
const BIP86 = {
  rootpriv:
    "xprv9s21ZrQH143K3GJpoapnV8SFfukcVBSfeCficPSGfubmSFDxo1kuHnLisriDvSnRRuL2Qrg5ggqHKNVpxR86QEC8w35uxmGoggxtQTPvfUu",
  receive0: "bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr",
  receive1: "bc1p4qhjn9zdvkux4e44uhx8tc55attvtyu358kutcqkudyccelu0was9fqzwh",
  change0: "bc1p3qkhfews2uk44qtvauqyr2ttdsw7svhkl9nkm9s9c3x4ax5h60wqwruhk7",
  internalKey0:
    "cc8a4bc64d897bddc5fbc2f670f7a8ba0b386779106cf1223c6fc5d7cd6fc115",
};

const root84 = HDKey.fromExtendedKey(asVersion(BIP84.rootpriv, VERSION.xprv));
const root86 = HDKey.fromExtendedKey(BIP86.rootpriv);
const fingerprint = (key: HDKey) =>
  key.fingerprint.toString(16).padStart(8, "0");
const H = 0x80000000;

const wpkh = parseDescriptor(
  `wpkh([${fingerprint(root84)}/84h/0h/0h]${BIP84_ZPUB}/<0;1>/*)`,
  "mainnet",
);
const tr = parseDescriptor(
  `tr([${fingerprint(root86)}/86h/0h/0h]${BIP86_XPUB}/<0;1>/*)`,
  "mainnet",
);

const script = (address: string) =>
  hex.encode(OutScript.encode(Address(NETWORK).decode(address)));

function coin(address: string, chain: number, index: number, value: number, n: number): Coin {
  return {
    txid: `${n}`.repeat(64),
    vout: n,
    value,
    script: script(address),
    address,
    chain,
    index,
    height: 800000,
    status: "confirmed",
    frozen: false,
  };
}

const wallets = [
  {
    name: "wpkh",
    descriptor: wpkh,
    root: root84,
    coins: [coin(BIP84.receive0, 0, 0, 60_000, 1), coin(BIP84.receive1, 0, 1, 50_000, 2)],
    recipient: BIP86.receive0,
    changeAddress: BIP84.change0,
  },
  {
    name: "tr",
    descriptor: tr,
    root: root86,
    coins: [coin(BIP86.receive0, 0, 0, 60_000, 1), coin(BIP86.receive1, 0, 1, 50_000, 2)],
    recipient: BIP84.receive0,
    changeAddress: BIP86.change0,
  },
];

function signed(psbt: Uint8Array, root: HDKey): Uint8Array {
  const tx = Transaction.fromPSBT(psbt);
  // Signing from the root checks the PSBT's fingerprints and paths. The cast
  // is only because bip32 types publicKey as nullable and btc-signer does not.
  tx.sign(root as unknown as Parameters<Transaction["sign"]>[0]);
  return tx.toPSBT();
}

describe.each(wallets)("a $name wallet", (wallet) => {
  const build = (tip = { height: 850_000, time: Date.now() / 1000 - 600 }) =>
    buildPsbt({
      descriptor: wallet.descriptor,
      network: "mainnet",
      coins: wallet.coins,
      recipients: [{ address: wallet.recipient, value: 70_000 }],
      change: { chain: 1, index: 0, value: 38_000 },
      tip,
    });

  // The build's own draws are the Uint32 ones, each taken modulo its range: the
  // one-in-ten, then how far back if so, then the change position.
  const real = crypto.getRandomValues.bind(crypto);
  const drawing = (...draws: number[]) => {
    vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
      if (!(array instanceof Uint32Array)) return real(array);
      array[0] = draws.shift()!;
      return array;
    });
  };
  afterEach(() => vi.restoreAllMocks());

  it("locks to the tip like Bitcoin Core, one time in ten up to 99 blocks back", () => {
    drawing(3, 0);
    expect(Transaction.fromPSBT(build().psbt).lockTime).toBe(850_000);
    drawing(10, 99, 0);
    expect(Transaction.fromPSBT(build().psbt).lockTime).toBe(850_000 - 99);
  });

  it("does not lock to a tip more than 8 hours old", () => {
    const stale = { height: 850_000, time: Date.now() / 1000 - 9 * 60 * 60 };
    expect(Transaction.fromPSBT(build(stale).psbt).lockTime).toBe(0);
  });

  it("puts the change at a random position", () => {
    const changeAt = () => reviewPsbt(build().psbt, wallet.descriptor, "mainnet").outputs.findIndex((o) => o.change);
    drawing(1, 0);
    expect(changeAt()).toBe(0);
    drawing(1, 1);
    expect(changeAt()).toBe(1);
  });

  it("builds a PSBT that signals RBF and carries key origins", () => {
    const { psbt, warnings } = build();
    expect(warnings).toEqual([]);
    const tx = Transaction.fromPSBT(psbt);
    const purpose = wallet.name === "wpkh" ? 84 : 86;
    for (let i = 0; i < tx.inputsLength; i++) {
      const input = tx.getInput(i);
      expect(input.sequence).toBe(0xfffffffd);
      expect(input.witnessUtxo?.amount).toBe(BigInt(wallet.coins[i]!.value));
      const der =
        wallet.name === "wpkh"
          ? input.bip32Derivation![0]![1]
          : input.tapBip32Derivation![0]![1].der;
      expect(der.fingerprint).toBe(wallet.root.fingerprint);
      expect(der.path).toEqual([purpose + H, H, H, 0, i]);
    }
    if (wallet.name === "tr") {
      expect(hex.encode(tx.getInput(0).tapInternalKey!)).toBe(BIP86.internalKey0);
    }
  });

  it("marks the change so a review can tell it from the payment", () => {
    const review = reviewPsbt(build().psbt, wallet.descriptor, "mainnet");
    expect(review.fee).toBe(2_000);
    expect(review.feeRate).toBeCloseTo(2_000 / review.vsize);
    expect(
      review.outputs.map(({ address, value, mine, change }) => ({ address, value, mine, change })),
    ).toEqual(
      expect.arrayContaining([
        { address: wallet.recipient, value: 70_000, mine: false, change: false },
        { address: wallet.changeAddress, value: 38_000, mine: true, change: true },
      ]),
    );
  });

  it("finalises a PSBT the signer signed into the transaction built", () => {
    const { psbt } = build();
    const raw = finaliseSigned(psbt, signed(psbt, wallet.root));
    const tx = Transaction.fromRaw(raw);
    expect(hex.encode(tx.unsignedTx)).toBe(hex.encode(Transaction.fromPSBT(psbt).unsignedTx));
    expect(tx.hasWitnesses).toBe(true);
    const estimate = reviewPsbt(psbt, wallet.descriptor, "mainnet").vsize;
    expect(estimate).toBeGreaterThanOrEqual(tx.vsize);
    expect(estimate).toBeLessThanOrEqual(tx.vsize + tx.inputsLength);
  });

  it("refuses a returned PSBT with a changed output amount", () => {
    const { psbt } = build();
    const tx = Transaction.fromPSBT(signed(psbt, wallet.root));
    const recipient = tx.getOutputAddress(0, NETWORK) === wallet.recipient ? 0 : 1;
    tx.updateOutput(recipient, { amount: 60_000n }, true);
    expect(() => finaliseSigned(psbt, tx.toPSBT())).toThrow(
      `Output ${recipient + 1} pays 60000 sats, but the one built pays 70000 sats`,
    );
  });

  it("refuses a returned PSBT with an extra output", () => {
    const { psbt } = build();
    const tx = Transaction.fromPSBT(signed(psbt, wallet.root));
    tx.addOutput({ script: hex.decode(script(BIP84.receive1)), amount: 1_000n }, true);
    expect(() => finaliseSigned(psbt, tx.toPSBT())).toThrow(
      "The signed transaction has 1 output more than the one built",
    );
  });

  it("refuses a returned PSBT that is missing a signature", () => {
    const { psbt } = build();
    const tx = Transaction.fromPSBT(psbt);
    tx.signIdx(
      wallet.root.derive(`m/${wallet.name === "wpkh" ? 84 : 86}'/0'/0'/0/0`).privateKey!,
      0,
    );
    expect(() => finaliseSigned(psbt, tx.toPSBT())).toThrow("Input 2 is not signed");
  });

  it("refuses signatures that do not commit to every output", () => {
    const { psbt } = build();
    for (const sighash of [SigHash.NONE, SigHash.SINGLE, SigHash.ALL_ANYONECANPAY]) {
      const tx = Transaction.fromPSBT(psbt);
      for (let i = 0; i < tx.inputsLength; i++) tx.updateInput(i, { sighashType: sighash });
      tx.sign(wallet.root as unknown as Parameters<Transaction["sign"]>[0], [sighash]);
      expect(() => finaliseSigned(psbt, tx.toPSBT())).toThrow(/Input 1 is signed so that whoever relays it/);
      tx.finalize();
      expect(() => finaliseSigned(psbt, tx.toPSBT())).toThrow(/Input 1 is signed so that whoever relays it/);
    }
  });

  it("accepts inputs the signer already finalised", () => {
    const { psbt } = build();
    const tx = Transaction.fromPSBT(signed(psbt, wallet.root));
    tx.finalize();
    expect(Transaction.fromRaw(finaliseSigned(psbt, tx.toPSBT())).id).toBe(Transaction.fromPSBT(psbt).id);
  });

  it("refuses a returned PSBT that pays the same amount to another address", () => {
    const { psbt } = build();
    const tx = Transaction.fromPSBT(signed(psbt, wallet.root));
    const recipient = tx.getOutputAddress(0, NETWORK) === wallet.recipient ? 0 : 1;
    tx.updateOutput(recipient, { script: hex.decode(script(BIP84.receive1)) }, true);
    expect(() => finaliseSigned(psbt, tx.toPSBT())).toThrow(
      `Output ${recipient + 1} pays a different address from the one built`,
    );
  });

  it("refuses a returned PSBT with a changed lock time or sequence", () => {
    const { psbt } = build();
    const raw = Transaction.fromPSBT(psbt);
    const changed = new Transaction({ version: 2, lockTime: 900_000 });
    for (let i = 0; i < raw.inputsLength; i++) changed.addInput({ ...raw.getInput(i), sequence: 0xffffffff });
    for (let i = 0; i < raw.outputsLength; i++) changed.addOutput(raw.getOutput(i) as never);
    expect(() => finaliseSigned(psbt, signed(changed.toPSBT(), wallet.root))).toThrow(
      "The signed transaction differs from the one built in its version, lock time or sequence numbers",
    );
  });
});

describe("building", () => {
  it("still produces a signable PSBT without a key origin, and says so", () => {
    const descriptor = descriptorFromExtendedKey(BIP84_ZPUB, "mainnet");
    const { psbt, warnings } = buildPsbt({
      descriptor,
      network: "mainnet",
      tip: null,
      coins: [coin(BIP84.receive0, 0, 0, 10_000, 1)],
      recipients: [{ address: BIP86.receive0, value: 9_000 }],
    });
    expect(warnings).toHaveLength(1);
    const account = HDKey.fromExtendedKey(asVersion(BIP84.accountpriv, VERSION.xprv));
    expect(finaliseSigned(psbt, signed(psbt, account)).length).toBeGreaterThan(0);
  });

  it("refuses a coin whose script is not at its stated derivation", () => {
    expect(() =>
      buildPsbt({
        descriptor: wpkh,
        network: "mainnet",
        tip: null,
        coins: [{ ...coin(BIP84.receive0, 0, 0, 10_000, 1), index: 1 }],
        recipients: [{ address: BIP86.receive0, value: 9_000 }],
      }),
    ).toThrow("does not belong to this wallet");
  });

  it("refuses outputs worth more than the coins", () => {
    expect(() =>
      buildPsbt({
        descriptor: wpkh,
        network: "mainnet",
        tip: null,
        coins: [coin(BIP84.receive0, 0, 0, 10_000, 1)],
        recipients: [{ address: BIP86.receive0, value: 11_000 }],
      }),
    ).toThrow("more than the chosen coins hold");
  });

  it("refuses a recipient on another network", () => {
    const signetAddress = Address(TEST_NETWORK).encode(
      OutScript.decode(hex.decode(script(BIP84.receive0))),
    );
    expect(() =>
      buildPsbt({
        descriptor: wpkh,
        network: "mainnet",
        tip: null,
        coins: [coin(BIP84.receive0, 0, 0, 10_000, 1)],
        recipients: [{ address: signetAddress, value: 9_000 }],
      }),
    ).toThrow("is not a valid mainnet address");
  });
});
