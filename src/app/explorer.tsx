import type { ReactNode } from "react";
import { linkClass } from "../ui/kit";
import { useVault } from "./vault";

export function explorerBase(value: string): string {
  if (!value.trim()) return "";
  const url = new URL(value.trim());
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.href.includes("?") ||
    url.href.includes("#")
  )
    throw new TypeError("Enter an http:// or https:// base URL without a login, query or fragment.");
  return url.href.replace(/\/+$/, "");
}

export function ExplorerLink({
  type,
  value,
  children,
}: {
  type: "tx" | "address";
  value: string;
  children?: ReactNode;
}) {
  const { settings, wallets, walletId } = useVault();
  const network = wallets.find((w) => w.id === walletId)?.network;
  let base = "";
  try {
    const configured = network && settings.explorers?.[network];
    if (typeof configured === "string") base = explorerBase(configured);
  } catch {}
  if (!base) return children ?? null;
  return (
    <a
      href={`${base}/${type}/${encodeURIComponent(value)}`}
      target="_blank"
      rel="noopener noreferrer"
      className={`${linkClass} min-w-0 [&_span]:text-carbon [&_span]:underline`}
      title="Open in your block explorer (new tab)"
    >
      {children ?? "View in explorer"}
    </a>
  );
}
