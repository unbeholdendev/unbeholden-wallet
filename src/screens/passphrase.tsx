import { useState, type ComponentProps } from "react";
import { inputClass } from "../ui/kit";

export const MIN_LENGTH = 10;

export const NO_PASSPHRASE = "No passphrase. Anyone using this browser can see your wallets: balances, history and future addresses.";

/**
 * A rough guess at guessing cost, enough to steer people towards several
 * random words. The vault's Argon2id costs do the rest.
 */
export function strength(passphrase: string) {
  if (passphrase.length < MIN_LENGTH) return { level: 0 as const };
  const pool =
    (/[a-z]/.test(passphrase) ? 26 : 0) +
    (/[A-Z]/.test(passphrase) ? 26 : 0) +
    (/\d/.test(passphrase) ? 10 : 0) +
    (/[^a-zA-Z\d]/.test(passphrase) ? 33 : 0);
  const repetitive = new Set(passphrase).size < passphrase.length / 3;
  const bits = passphrase.length * Math.log2(pool) * (repetitive ? 0.5 : 1);
  return { level: bits < 50 ? (1 as const) : bits < 70 ? (2 as const) : (3 as const) };
}

const words = {
  0: `At least ${MIN_LENGTH} characters. Four or five random words work well.`,
  1: "Weak. Someone with this device could guess it. Add more words.",
  2: "Fair. One more random word would make it strong.",
  3: "Strong.",
};
const fills = { 0: "bg-rule-2", 1: "bg-bad", 2: "bg-warn", 3: "bg-ok" };

export function Strength({ score }: { score: ReturnType<typeof strength> }) {
  return (
    <span className="grid gap-1.5">
      <span aria-hidden="true" className="grid h-1.5 w-full max-w-60 grid-cols-3 gap-0.5">
        {[1, 2, 3].map((n) => (
          <span key={n} className={`rounded-full ${n <= score.level ? fills[score.level] : "bg-rule"}`} />
        ))}
      </span>
      <span>{words[score.level]}</span>
    </span>
  );
}

export function PassphraseInput({ value, onChange, ...rest }: Omit<ComponentProps<"input">, "onChange"> & { onChange: (value: string) => void }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <input
        {...rest}
        type={shown ? "text" : "password"}
        spellCheck={false}
        autoCapitalize="none"
        className={`${inputClass} pr-16`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        onClick={() => setShown(!shown)}
        className="absolute inset-y-1 right-1 rounded-[4px] px-2.5 text-sm font-medium text-ink-2 hover:bg-sunk"
      >
        {shown ? "Hide" : "Show"}
      </button>
    </div>
  );
}
