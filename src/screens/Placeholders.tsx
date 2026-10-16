import { useVault } from "../app/vault";
import { Empty } from "../ui/kit";

const screens = {
  home: { title: "Home", empty: "Balance and history appear here once this wallet has synced." },
  send: { title: "Send", empty: "Choosing coins and building a transaction will live here." },
  receive: { title: "Receive", empty: "The next unused address and its QR code will live here." },
  coins: { title: "Coins", empty: "Every coin this wallet holds, grouped by where it came from, will live here." },
  addresses: { title: "Addresses", empty: "Receive and change addresses, used and unused, will live here." },
  tx: { title: "Transaction", empty: "Inputs, outputs, fee and block for one transaction will live here." },
};

export function Placeholder({ screen, detail }: { screen: keyof typeof screens; detail?: string }) {
  const { wallets, walletId } = useVault();
  const wallet = wallets.find((w) => w.id === walletId);
  const { title, empty } = screens[screen];
  return (
    <div className="grid content-start gap-4">
      <h1 className="m-0 text-xl font-semibold">{title}</h1>
      <Empty title={`Not built yet${wallet ? ` for ${wallet.name}` : ""}`}>
        <p className="m-0">{empty}</p>
        {detail && <p className="m-0 mt-2 font-mono text-[0.86em] break-all text-ink-3">{detail}</p>}
      </Empty>
    </div>
  );
}
