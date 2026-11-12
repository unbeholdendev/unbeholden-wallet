import { type FormEvent, useEffect, useState } from "react";
import { type Connection, type Failure, useConnection } from "../app/connection";
import { Heading } from "../app/layout";
import { useVault } from "../app/vault";
import { POLL_SECONDS } from "../backend/esplora";
import { groupSats } from "../ui/amount";
import { hostText } from "../ui/format";
import { Button, buttonClass, Field, inputClass, Notice } from "../ui/kit";
import { Guidance } from "./connect/Guidance";

const breaks: Record<Failure, string> = {
  bridge: "container's link",
  "certificate-rejected": "certificate",
  "mixed-content": "blocked by the browser",
  refused: "refused",
  timeout: "no answer",
  "not-electrum": "not Electrum",
  "not-esplora": "not Esplora",
  cors: "not allowed",
  "invalid-url": "",
};

/** Each failure in one sentence, for where its guidance does not fit. */
export const reasons: Record<Failure, string> = {
  bridge: "The container couldn't reach your Electrum server.",
  "certificate-rejected": "The browser rejected its certificate.",
  "mixed-content": "This page can't open a plain ws:// or http:// connection.",
  refused: "Nothing there accepted the connection.",
  timeout: "It didn't answer within 10 seconds.",
  "not-electrum": "Something answered, but not an Electrum server.",
  "not-esplora": "Something answered, but not an Esplora API.",
  cors: "It answered, but didn't let this app read the answer.",
  "invalid-url": "Its address isn't a wss://, ws://, https:// or http:// URL.",
};

/** The connection drawn as a route from this tab to the server, broken where it failed. */
function RouteLine({ connection }: { connection: Connection }) {
  const failed = connection.phase === "failed" ? connection.failure : null;
  const reached = connection.phase === "connected" || connection.phase === "retrying";
  const live = connection.phase === "connecting" || connection.phase === "retrying";
  const label = failed ? breaks[failed] : "";
  return (
    <svg
      viewBox="0 0 360 64"
      className="h-16 w-full max-w-[640px]"
      preserveAspectRatio="xMinYMid meet"
      role="img"
      aria-label={
        failed
          ? `The route from this tab to your server stops: ${label}.`
          : reached
            ? "This tab talks only to your server."
            : "This tab will talk only to your server."
      }
    >
      <circle cx="18" cy="32" r="7" className="fill-sheet stroke-ink stroke-[1.6]" />
      <text x="18" y="58" textAnchor="middle" className="fill-ink-2 text-[11px]">
        This tab
      </text>
      <path
        d={`M28 32H${failed ? 168 : 330}`}
        className={`fill-none stroke-2 [stroke-dasharray:5_4] ${failed || reached || live ? "stroke-carbon" : "stroke-rule-2"} ${live ? "animate-[march_900ms_linear_infinite]" : ""}`}
      />
      {failed && (
        <>
          <path d="M173 24l14 16M187 24l-14 16" className="stroke-bad stroke-[2.4] [stroke-linecap:round]" />
          <text x="180" y="14" textAnchor="middle" className="fill-bad text-[11px] font-bold">
            {label}
          </text>
          <path d="M193 32H330" className="fill-none stroke-rule-2 stroke-2 [stroke-dasharray:5_4]" />
        </>
      )}
      <g transform="translate(342 32)">
        <path
          d="M0 -9L8 6H-8Z"
          className={`stroke-[1.6] ${reached ? "fill-carbon-tint stroke-carbon" : "fill-sheet stroke-ink"}`}
        />
        <circle r="2" cy="1.5" className={reached ? "fill-carbon" : "fill-ink"} />
      </g>
      <text x="352" y="58" textAnchor="end" className="fill-ink-2 text-[11px]">
        Your server
      </text>
    </svg>
  );
}

function Status({ connection }: { connection: Connection }) {
  const { wallets } = useVault();
  if (connection.phase === "connected" || connection.phase === "retrying") {
    const { network } = connection;
    const astray = network ? wallets.filter((w) => w.network !== network) : [];
    return (
      <section className="grid gap-2 rounded-panel border border-rule bg-sheet p-4">
        <h2 className="m-0 flex items-center gap-2 text-md font-bold">
          <span className={`size-2 rounded-full ${connection.phase === "connected" ? "bg-ok" : "bg-warn"}`} />
          {connection.phase === "connected"
            ? `Connected to ${hostText(connection.url)}`
            : `Reconnecting to ${hostText(connection.url)}`}
        </h2>
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
          <dt className="text-ink-2">Server software</dt>
          <dd className="m-0">{connection.software ?? "Not reported"}</dd>
          <dt className="text-ink-2">Chain tip</dt>
          <dd className="m-0">{connection.tip === null ? "Asking" : `Block ${groupSats(connection.tip)}`}</dd>
          {network && (
            <>
              <dt className="text-ink-2">Network</dt>
              <dd className="m-0 capitalize">{network}</dd>
            </>
          )}
          {/^https?:/.test(connection.url) && (
            <>
              <dt className="text-ink-2">Updates</dt>
              <dd className="m-0">
                Asks for a new block every {POLL_SECONDS} seconds. Esplora can't announce a payment, so one still in the
                mempool shows at the next block or when you refresh.
              </dd>
            </>
          )}
        </dl>
        {astray.map((w) => (
          <Notice key={w.id} tone="warn">
            This server is on {network}, but {w.name} is a {w.network} wallet. It will look empty here.
          </Notice>
        ))}
        {!wallets.length && (
          <a className={`${buttonClass({ variant: "primary" })} justify-self-start`} href="#/import">
            Next: add a wallet
          </a>
        )}
      </section>
    );
  }
  return (
    <section className="grid gap-2 rounded-panel border border-rule bg-sheet p-4">
      <h2 className="m-0 text-md font-bold">What happens when you connect</h2>
      <p className="m-0 text-sm text-ink-2">
        The app asks your server for block headers and for the history of your addresses. Your addresses and
        transactions go to that server and nowhere else.
      </p>
    </section>
  );
}

export function Connect({ onboarding = false }: { onboarding?: boolean }) {
  const { settings, saveSettings } = useVault();
  const { connection, connect } = useConnection();
  const [url, setUrl] = useState(settings.server ?? (connection.phase === "idle" ? "" : connection.url));
  const busy = connection.phase === "connecting";
  const failed = connection.phase === "failed" && connection.url === url.trim() ? connection : null;
  const invalid = failed?.failure === "invalid-url";

  useEffect(() => {
    if (url) return;
    fetch("electrum.json")
      .then((r) => r.json())
      .then(
        (bridge: { url?: unknown }) =>
          typeof bridge.url === "string" &&
          setUrl((u) => u || new URL("electrum", location.href).href.replace(/^http/, "ws")),
      )
      .catch(() => {});
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const target = url.trim();
    if (!target) return;
    if (target !== settings.server) await saveSettings({ server: target });
    await connect(target);
  };

  return (
    <div className="grid gap-8">
      <div className="grid gap-4">
        <Heading title={onboarding ? "Connect to your server" : "Your server"}>
          This wallet talks only to a server you run.
        </Heading>
        <RouteLine connection={connection.phase === "failed" && !failed ? { phase: "idle" } : connection} />
      </div>
      <div className="grid items-start gap-6 @min-[900px]:grid-cols-[400px_minmax(0,1fr)] @min-[900px]:gap-12">
        <form onSubmit={submit} className="grid min-w-0 content-start gap-4" noValidate>
          <Field
            label="Server address"
            hint="An Electrum server as wss:// and its WebSocket Secure port, often 50004, or an Esplora API as its https:// address."
            error={
              invalid
                ? "Write it as wss://host:port, for example wss://node.example.com:50004, or as https://host/api."
                : undefined
            }
          >
            {(props) => (
              <input
                {...props}
                className={`${inputClass} font-mono text-[0.86em] ${failed && !invalid ? "border-bad" : ""}`}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="wss://node.example.com:50004"
                spellCheck={false}
                autoCapitalize="none"
                autoComplete="off"
                inputMode="url"
              />
            )}
          </Field>
          {busy && (
            <p className="m-0 text-sm text-ink-2" role="status">
              Connecting to {hostText(url)}. Waiting up to 10 seconds for an answer.
            </p>
          )}
          <Button
            type="submit"
            variant="primary"
            wide
            disabled={busy || !url.trim()}
            icon={failed && !invalid ? "retry" : undefined}
          >
            {failed && !invalid
              ? "Retry connection"
              : busy
                ? "Connecting"
                : connection.phase === "connected" && connection.url === url.trim()
                  ? "Reconnect"
                  : "Connect"}
          </Button>
          <p className="m-0 text-sm text-ink-3">
            There's no default or public server. If yours is unreachable, this app does nothing rather than ask someone
            else.
          </p>
        </form>
        {failed && !invalid ? (
          <Guidance failure={failed.failure} url={failed.url} message={failed.message} />
        ) : (
          <Status connection={connection} />
        )}
      </div>
    </div>
  );
}
