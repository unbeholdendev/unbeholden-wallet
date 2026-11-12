import type { Store } from "../vault/vault";
import { outpoint } from "../wallet/coin";
import { type Bip329Record, formatBip329, parseBip329, sameOrigin } from "./bip329";
import type { WalletSession } from "./wallet";

export type Annotations = Pick<WalletSession, "setLabel" | "setFrozen" | "setKyc" | "exportLabels" | "importLabels"> & {
  labels: Record<string, string>;
  frozen: Set<string>;
  kyc: Set<string>;
};

/** Labels, frozen coins and KYC marks. Each change calls `changed` before it is saved. */
export async function openAnnotations(
  vault: Store,
  id: string,
  origin: string | null,
  changed: () => void,
): Promise<Annotations> {
  const labels: Record<string, string> = (await vault.get(`labels/${id}`)) ?? {};
  const frozen = new Set<string>((await vault.get<string[]>(`frozen/${id}`)) ?? []);
  const kyc = new Set<string>((await vault.get<string[]>(`kyc/${id}`)) ?? []);

  const saveLabels = () => vault.put(`labels/${id}`, labels);
  const saveFrozen = () => vault.put(`frozen/${id}`, [...frozen]);
  const saveKyc = () => vault.put(`kyc/${id}`, [...kyc]);

  return {
    labels,
    frozen,
    kyc,
    async setLabel(type, ref, label) {
      if (label) labels[`${type}:${ref}`] = label;
      else delete labels[`${type}:${ref}`];
      changed();
      await saveLabels();
    },
    async setFrozen(coin, on) {
      if (on) frozen.add(outpoint(coin));
      else frozen.delete(outpoint(coin));
      changed();
      await saveFrozen();
    },
    async setKyc(coins, on) {
      for (const c of coins) {
        if (on) kyc.add(outpoint(c));
        else kyc.delete(outpoint(c));
      }
      changed();
      await saveKyc();
    },
    exportLabels() {
      const records = new Map<string, Bip329Record>();
      for (const [key, label] of Object.entries(labels)) {
        const at = key.indexOf(":");
        records.set(key, { type: key.slice(0, at), ref: key.slice(at + 1), label });
      }
      for (const point of frozen) {
        const key = `output:${point}`;
        records.set(key, { ...(records.get(key) ?? { type: "output", ref: point }), spendable: false });
      }
      for (const point of kyc) {
        const key = `output:${point}`;
        records.set(key, { ...(records.get(key) ?? { type: "output", ref: point }), kyc: true });
      }
      return formatBip329([...records.values()].map((r) => (origin ? { ...r, origin } : r)));
    },
    async importLabels(text) {
      const { records, skipped } = parseBip329(text);
      let imported = 0;
      for (const r of records) {
        if (r.origin && origin && !sameOrigin(r.origin, origin)) continue;
        imported++;
        if (r.label !== undefined) {
          if (r.label) labels[`${r.type}:${r.ref}`] = r.label;
          else delete labels[`${r.type}:${r.ref}`];
        }
        if (r.type === "output" && r.spendable !== undefined) {
          if (r.spendable) frozen.delete(r.ref);
          else frozen.add(r.ref);
        }
        if (r.type === "output" && r.kyc !== undefined) {
          if (r.kyc) kyc.add(r.ref);
          else kyc.delete(r.ref);
        }
      }
      changed();
      await Promise.all([saveLabels(), saveFrozen(), saveKyc()]);
      return { imported, skipped: skipped + records.length - imported };
    },
  };
}
