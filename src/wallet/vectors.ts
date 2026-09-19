import { base58check } from "@scure/base";
import { sha256 } from "@scure/btc-signer/utils.js";

/**
 * Account 0 of the BIP84 test vectors, and of the BIP86 ones. Both derive from
 * the mnemonic "abandon abandon ... about".
 *
 * BIP84: https://github.com/bitcoin/bips/blob/master/bip-0084.mediawiki
 * BIP86: https://github.com/bitcoin/bips/blob/master/bip-0086.mediawiki
 */
export const BIP84_ZPUB =
  "zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs";
export const BIP86_XPUB =
  "xpub6BgBgsespWvERF3LHQu6CnqdvfEvtMcQjYrcRzx53QJjSxarj2afYWcLteoGVky7D3UKDP9QyrLprQ3VCECoY49yfdDEHGCtMMj92pReUsQ";

/**
 * Kept separate from the table in `extended-key.ts` on purpose: if the tests
 * imported that one, a wrong version byte would agree with itself and pass.
 * https://github.com/satoshilabs/slips/blob/master/slip-0132.md
 */
export const VERSION = {
  xpub: 0x0488b21e,
  ypub: 0x049d7cb2,
  zpub: 0x04b24746,
  Ypub: 0x0295b43f,
  Zpub: 0x02aa7ed3,
  tpub: 0x043587cf,
  upub: 0x044a5262,
  vpub: 0x045f1cf6,
  Upub: 0x024289ef,
  Vpub: 0x02575483,
  xprv: 0x0488ade4,
};

export function asVersion(key: string, version: number): string {
  const raw = base58check(sha256).decode(key);
  new DataView(raw.buffer, raw.byteOffset, raw.byteLength).setUint32(0, version);
  return base58check(sha256).encode(raw);
}

/** Replaces the key bytes with the private-key shape: a zero, then 32 bytes. */
export function asPrivate(key: string): string {
  const raw = base58check(sha256).decode(key);
  raw.set([0], 45);
  return base58check(sha256).encode(raw);
}
