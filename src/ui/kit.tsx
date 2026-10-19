import { useId, type ComponentProps, type ReactNode } from "react";
import { Icon, type IconName } from "./icons";

const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-control border font-bold transition-colors disabled:cursor-not-allowed disabled:border-rule disabled:bg-rule disabled:text-ink-3";
const variants = {
  default: "border-rule-2 bg-sheet text-ink hover:bg-sunk",
  primary:
    "border-carbon bg-carbon text-carbon-ink hover:border-carbon-hover hover:bg-carbon-hover",
  danger: "border-rule-2 bg-sheet text-bad hover:bg-bad-tint",
};
const sizes = { md: "min-h-11 px-4 py-2 text-base", sm: "min-h-8 px-2.5 py-1 text-sm" };

type ButtonProps = ComponentProps<"button"> & {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  icon?: IconName;
  wide?: boolean;
};

export function buttonClass({ variant = "default", size = "md", wide = false }: Omit<ButtonProps, "icon">) {
  return `${buttonBase} ${variants[variant]} ${sizes[size]} ${wide ? "w-full" : ""}`;
}

export function Button({ variant, size, icon, wide, className = "", children, ...rest }: ButtonProps) {
  return (
    <button type="button" className={`${buttonClass({ variant, size, wide })} ${className}`} {...rest}>
      {icon && <Icon name={icon} />}
      {children}
    </button>
  );
}

export const linkClass =
  "cursor-pointer font-bold text-carbon underline decoration-1 underline-offset-3 hover:decoration-2";

export function LinkButton({ className = "", ...rest }: ComponentProps<"button">) {
  return <button type="button" className={`${linkClass} ${className}`} {...rest} />;
}

export const inputClass =
  "w-full min-h-11 rounded-control border border-rule-2 bg-sheet px-3 py-2.5 text-ink caret-carbon placeholder:text-ink-3 focus:border-transparent focus:outline-2 focus:-outline-offset-1 focus:outline-carbon aria-invalid:border-bad";

type FieldProps = {
  label: string;
  hint?: ReactNode;
  error?: ReactNode;
  ok?: ReactNode;
  children: (props: { id: string; "aria-describedby": string | undefined; "aria-invalid": boolean }) => ReactNode;
};

/** A labelled control with one hint line that turns into the error or the confirmation. */
export function Field({ label, hint, error, ok, children }: FieldProps) {
  const id = useId();
  const note = error ?? ok ?? hint;
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-bold">
        {label}
      </label>
      {children({ id, "aria-describedby": note ? `${id}-note` : undefined, "aria-invalid": !!error })}
      {note && (
        <p
          id={`${id}-note`}
          className={`flex items-start gap-1.5 text-sm ${error ? "text-bad" : ok ? "text-ok" : "text-ink-3"}`}
        >
          {error ? <Icon name="warn" className="mt-px size-4" /> : ok ? <Icon name="check" className="mt-px size-4" /> : null}
          <span>{note}</span>
        </p>
      )}
    </div>
  );
}

export function Panel({ title, aside, children, className = "" }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-panel border border-rule bg-sheet ${className}`}>
      {title && (
        <div className="flex items-baseline justify-between gap-3 px-4 pt-4">
          <h2 className="text-md font-bold">{title}</h2>
          {aside && <span className="text-sm text-ink-3">{aside}</span>}
        </div>
      )}
      <div className="grid gap-3 px-4 pt-3 pb-4">{children}</div>
    </section>
  );
}

const chips = {
  neutral: "bg-sunk text-ink-2",
  ok: "bg-ok-tint text-ok",
  warn: "bg-warn-tint text-warn",
  bad: "bg-bad-tint text-bad",
  carbon: "bg-carbon-tint text-carbon",
  join: "bg-tamper text-tamper-ink",
};

export function Chip({ tone = "neutral", children }: { tone?: keyof typeof chips; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-chip px-2 py-px text-xs font-bold ${chips[tone]}`}>
      {children}
    </span>
  );
}

/** Pick one of a few options; pressed state in carbon. */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: ReactNode }[];
  value: T | null;
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex overflow-hidden rounded-control border border-rule-2 bg-sheet">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className="min-h-10 flex-1 border-l border-rule-2 px-3 py-2 text-sm font-medium text-ink-2 first:border-l-0 aria-pressed:bg-carbon-tint aria-pressed:font-bold aria-pressed:text-carbon"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Numbered instructions, the way a route card lists turns. */
export function Steps({ children }: { children: ReactNode }) {
  return (
    <ol className="m-0 grid list-none gap-3 p-0 [counter-reset:s] [&>li]:grid [&>li]:grid-cols-[28px_1fr] [&>li]:gap-2.5 [&>li>*]:min-w-0 [&>li]:[counter-increment:s] [&>li]:before:grid [&>li]:before:size-6 [&>li]:before:place-items-center [&>li]:before:rounded-full [&>li]:before:border-[1.5px] [&>li]:before:border-ink [&>li]:before:text-sm [&>li]:before:font-bold [&>li]:before:content-[counter(s)]">
      {children}
    </ol>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="grid justify-items-start gap-2 rounded-panel border border-dashed border-rule-2 px-5 py-8">
      <h2 className="text-md font-bold">{title}</h2>
      {children && <div className="max-w-[60ch] text-ink-2">{children}</div>}
    </div>
  );
}

export function Notice({ tone, children }: { tone: "warn" | "bad" | "ok"; children: ReactNode }) {
  const tones = { warn: "bg-warn-tint text-warn", bad: "bg-bad-tint text-bad", ok: "bg-ok-tint text-ok" };
  return (
    <div role={tone === "bad" ? "alert" : "status"} className={`flex items-start gap-2 rounded-control px-3 py-2.5 text-sm ${tones[tone]}`}>
      <Icon name={tone === "ok" ? "check" : "warn"} className="mt-px size-[18px]" />
      <div>{children}</div>
    </div>
  );
}
