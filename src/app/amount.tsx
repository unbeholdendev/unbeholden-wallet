import { btcParts, groupSats } from "../ui/amount";
import { Segmented } from "../ui/kit";
import { useHidden, useUnit, useVault } from "./vault";

export function Amount({ sats, unit = false, signed = false }: { sats: number; unit?: boolean; signed?: boolean }) {
  const inSats = useUnit() === "sats";
  if (useHidden())
    return (
      <span role="img" aria-label="Hidden" className="whitespace-nowrap text-ink-3">
        ••••••
      </span>
    );
  const { lead, rest } = inSats ? { lead: "", rest: groupSats(Math.abs(sats)) } : btcParts(sats);
  const incoming = signed && sats > 0;
  const sign = sats < 0 ? "−" : incoming ? "+" : "";
  return (
    <span className={`whitespace-nowrap tabular-nums ${incoming ? "text-ok" : ""}`}>
      {sign}
      <span className={incoming ? "opacity-75" : "font-normal text-ink-3"}>{lead}</span>
      {rest}
      {unit && (
        <span className="ml-[0.3em] text-[0.62em] font-bold tracking-[0.04em] text-ink-3">
          {inSats ? "sats" : "BTC"}
        </span>
      )}
    </span>
  );
}

export function UnitSwitch() {
  const { settings, saveSettings } = useVault();
  return (
    <Segmented
      label="Amounts in"
      value={settings.unit ?? "btc"}
      onChange={(unit) => void saveSettings({ unit })}
      options={[
        { value: "btc", label: "BTC" },
        { value: "sats", label: "sats" },
      ]}
    />
  );
}
