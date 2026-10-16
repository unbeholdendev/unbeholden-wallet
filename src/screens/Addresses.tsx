import { useState } from "react";
import { useWalletSession, useWalletSnapshot } from "../app/session";
import type { AddressInfo } from "../core/wallet";
import { Button, Chip, LinkButton, Segmented } from "../ui/kit";
import { useToast } from "../ui/toast";
import { EditableLabel, GroupedAddress, Opening } from "./parts";

type Chain = "receive" | "change";
type Show = "all" | "used" | "unused";

const DEEPER = 100;

function Row({ info, next }: { info: AddressInfo; next: boolean }) {
  return (
    <li className="grid gap-1 border-t border-rule px-4 py-3 @min-[720px]:grid-cols-[48px_minmax(0,1fr)_200px] @min-[720px]:gap-x-4">
      <span className="text-sm text-ink-3 tabular-nums @min-[720px]:row-span-2 @min-[720px]:pt-0.5">#{info.index}</span>
      <GroupedAddress address={info.address} className="text-[0.86em]" />
      <span className="flex flex-wrap items-center gap-1.5 @min-[720px]:justify-end">
        {next && <Chip tone="route">Next to give out</Chip>}
        {info.reused && <Chip tone="bad">Reused, paid {info.txCount} times</Chip>}
        {info.used ? !info.reused && <Chip>{info.txCount === 1 ? "1 transaction" : `${info.txCount} transactions`}</Chip> : !next && <Chip>Unused</Chip>}
      </span>
      <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm @min-[720px]:col-span-2 @min-[720px]:col-start-2">
        <span className="font-mono text-xs text-ink-3">{info.path}</span>
        <EditableLabel type="addr" target={info.address} value={info.label} />
      </span>
    </li>
  );
}

export function Addresses() {
  const snapshot = useWalletSnapshot();
  const session = useWalletSession();
  const toast = useToast();
  const [chain, setChain] = useState<Chain>("receive");
  const [show, setShow] = useState<Show>("all");
  const [scanning, setScanning] = useState(false);
  if (!snapshot) return <Opening title="Addresses" />;

  const all = snapshot.addresses[chain];
  // "All" stops at the first unused address; the rest are only the watched gap.
  const end = show === "all" ? all.findLastIndex((a) => a.used) + 2 : all.length;
  const list = all.slice(0, end).filter((a) => show === "all" || a.used === (show === "used"));
  const reused = [...snapshot.addresses.receive, ...snapshot.addresses.change].filter((a) => a.reused).length;
  const scan = async () => {
    setScanning(true);
    await session?.scanDeeper(DEEPER);
    setScanning(false);
    toast(`Checked ${DEEPER} more addresses on each chain`);
  };

  return (
    <div className="grid content-start items-start gap-6 @min-[900px]/app:grid-cols-[minmax(0,1fr)_320px]">
      <h1 className="m-0 text-xl font-semibold @min-[900px]/app:col-span-2">Addresses</h1>
      <section className="@container min-w-0 rounded-panel border border-rule bg-sheet">
        <div className="grid gap-3 p-4 @min-[560px]:grid-cols-2">
          <Segmented
            label="Chain"
            value={chain}
            onChange={setChain}
            options={[
              { value: "receive", label: `Receive, ${snapshot.addresses.receive.length}` },
              { value: "change", label: `Change, ${snapshot.addresses.change.length}` },
            ]}
          />
          <Segmented
            label="Show"
            value={show}
            onChange={setShow}
            options={[
              { value: "all", label: "All" },
              { value: "used", label: "Used" },
              { value: "unused", label: "Unused" },
            ]}
          />
        </div>
        {reused > 0 && (
          <p className="m-0 border-t border-rule bg-bad-tint px-4 py-2.5 text-sm text-ink">
            <b className="font-semibold text-bad">{reused === 1 ? "One address was" : `${reused} addresses were`} paid more than once.</b>{" "}
            Anyone can see those payments went to the same person. Give out a fresh address each time.
          </p>
        )}
        <ul className="m-0 list-none p-0">
          {list.map((info) => (
            <Row key={info.address} info={info} next={info.address === snapshot.nextReceive.address} />
          ))}
        </ul>
        {!list.length && <p className="m-0 border-t border-rule px-4 py-6 text-ink-3">No {show} addresses on this chain yet.</p>}
        {all.length > end && (
          <p className="m-0 border-t border-rule px-4 py-3 text-sm text-ink-3">
            {all.length - end} more unused addresses after these are watched for payments.{" "}
            <LinkButton onClick={() => setShow("unused")}>Show unused</LinkButton>
          </p>
        )}
      </section>
      <section className="grid gap-3 rounded-panel border border-rule bg-sheet p-4">
        <h2 className="text-md font-semibold">Scan further</h2>
        <p className="m-0 text-sm text-ink-2">
          This wallet stops looking after 20 unused addresses in a row. If another wallet gave out addresses further
          along, for example to a service that generates its own, coins paid to them stay hidden until you scan further.
        </p>
        <p className="m-0 text-sm text-ink-2">It checks {DEEPER} more addresses on each chain with your server.</p>
        <Button className="justify-self-start" icon="scan" disabled={scanning || snapshot.connection !== "connected"} onClick={scan}>
          {scanning ? "Scanning" : "Scan further"}
        </Button>
      </section>
    </div>
  );
}
