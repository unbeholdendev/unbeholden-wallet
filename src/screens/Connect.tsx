import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useConnection, type Connection, type Failure } from "../app/connection";
import { Heading } from "../app/layout";
import { useVault } from "../app/vault";
import { POLL_SECONDS } from "../backend/esplora";
import { groupSats } from "../ui/amount";
import { hostText } from "../ui/format";
import { Icon } from "../ui/icons";
import { Button, buttonClass, Field, inputClass, linkClass, Notice, Steps } from "../ui/kit";

const httpsForm = (url: string) => `https://${hostText(url)}/`;

const breaks: Record<Failure, string> = {
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
  "certificate-rejected": "The browser rejected its certificate.",
  "mixed-content": "This page cannot open a plain ws:// or http:// connection.",
  refused: "Nothing there accepted the connection.",
  timeout: "It did not answer within 10 seconds.",
  "not-electrum": "Something answered, but not an Electrum server.",
  "not-esplora": "Something answered, but not an Esplora API.",
  cors: "It answered, but did not let this app read the answer.",
  "invalid-url": "Its address is not a wss://, ws://, https:// or http:// URL.",
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
        failed ? `The route from this tab to your server stops: ${label}.` : reached ? "This tab talks only to your server." : "This tab will talk only to your server."
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
        <path d="M0 -9L8 6H-8Z" className={`stroke-[1.6] ${reached ? "fill-carbon-tint stroke-carbon" : "fill-sheet stroke-ink"}`} />
        <circle r="2" cy="1.5" className={reached ? "fill-carbon" : "fill-ink"} />
      </g>
      <text x="352" y="58" textAnchor="end" className="fill-ink-2 text-[11px]">
        Your server
      </text>
    </svg>
  );
}

function Url({ children }: { children: ReactNode }) {
  return <span className="mt-1 inline-block rounded-[4px] bg-sunk px-2 py-1 font-mono text-[0.86em] break-all">{children}</span>;
}

const certificate = (
  <p className="m-0">
    To stop this happening on every device, give your server a certificate your browser trusts.{" "}
    <a className={linkClass} href="#/guide">
      How to get one
    </a>
  </p>
);

function Guidance({ failure, url, message }: { failure: Failure | null; url: string; message: string }) {
  const h = hostText(url);
  const guides: Record<Exclude<Failure, "invalid-url">, { title: string; body: ReactNode; more?: ReactNode }> = {
    "certificate-rejected": {
      title: "The browser rejected this server's certificate",
      body: (
        <>
          <p className="m-0">
            Your server at <span className="font-mono text-[0.86em]">{h}</span> answered, but with a certificate this
            browser does not trust, usually because it is self-signed. WebSocket connections have no "proceed anyway"
            button, so you accept the certificate once in an ordinary tab.
          </p>
          <Steps>
            <li>
              <div>
                <b className="font-bold">Open the server's https address in a new tab.</b>
                <br />
                <Url>{httpsForm(url)}</Url>{" "}
                <a className={`${buttonClass({ size: "sm" })} mt-1 align-middle`} href={httpsForm(url)} target="_blank" rel="noreferrer">
                  Open it <Icon name="ext" className="size-4" />
                </a>
              </div>
            </li>
            <li>
              <div>
                <b className="font-bold">Check the warning is about your own server, then accept it.</b> In Chrome
                choose Advanced, then Proceed. In Firefox choose Advanced, then Accept the Risk and Continue. In Safari
                choose Show Details, then visit this website.
              </div>
            </li>
            <li>
              <div>
                <b className="font-bold">Expect a blank page or an error there.</b> That is normal. Close that tab.
              </div>
            </li>
            <li>
              <div>
                <b className="font-bold">Come back here and choose Retry connection.</b>
              </div>
            </li>
          </Steps>
        </>
      ),
      more: certificate,
    },
    "mixed-content": {
      title: "This page cannot open a plain ws:// or http:// connection",
      body: (
        <>
          <p className="m-0">
            This app was loaded over https, and browsers do not let an https page open an unencrypted ws:// or http:// connection to
            another machine. There are two ways round it.
          </p>
          <Steps>
            <li>
              <div>
                <b className="font-bold">Give your server a certificate and use wss:// or https://.</b>{" "}
                <a className={linkClass} href="#/guide">How to get one</a>
              </div>
            </li>
            <li>
              <div>
                <b className="font-bold">Or run this app from the local container.</b> It serves the app on{" "}
                <span className="font-mono text-[0.86em]">http://localhost:8080</span>, and a localhost page may open
                ws:// or http:// to a node on your own network.{" "}
                <a className={linkClass} href="#/guide">How to run it</a>
              </div>
            </li>
          </Steps>
        </>
      ),
    },
    refused: {
      title: `Nothing at ${h} accepted the connection`,
      body: (
        <>
          <p className="m-0">The address was reached, or looked up, but no service took the connection. Check, in order:</p>
          <Steps>
            <li>
              <div>
                <b className="font-bold">The server is running</b> and has finished starting up.
              </div>
            </li>
            <li>
              {/^https?:/.test(url) ? (
                <div>
                  <b className="font-bold">The port is the one your Esplora API listens on</b>, not the explorer's
                  web page if it serves that elsewhere.
                </div>
              ) : (
                <div>
                  <b className="font-bold">The port is the WebSocket one.</b> Fulcrum's TCP ports (50001, 50002) do
                  not speak WebSocket; the <span className="font-mono text-[0.86em]">ws</span> and{" "}
                  <span className="font-mono text-[0.86em]">wss</span> settings in fulcrum.conf name the right ports. A server with only a TCP port, such as electrs, is
                  reached through the local container.{" "}
                  <a className={linkClass} href="#/guide">How to run it</a>
                </div>
              )}
            </li>
            <li>
              <div>
                <b className="font-bold">Nothing between you blocks it:</b> a firewall on the node, or a router that
                does not forward the port.
              </div>
            </li>
            {/^(wss|https):/.test(url) && (
              <li>
                <div>
                  <b className="font-bold">A self-signed certificate can look exactly like this.</b> Open{" "}
                  <Url>{httpsForm(url)}</Url> in a new tab, accept the warning if it is about your own server, then
                  come back and retry.{" "}
                  <a className={`${buttonClass({ size: "sm" })} mt-1 align-middle`} href={httpsForm(url)} target="_blank" rel="noreferrer">
                    Open it <Icon name="ext" className="size-4" />
                  </a>
                </div>
              </li>
            )}
          </Steps>
        </>
      ),
      more: certificate,
    },
    timeout: {
      title: `${h} did not answer within 10 seconds`,
      body: (
        <>
          <p className="m-0">Nothing came back at all, which usually means this device cannot reach that address:</p>
          <Steps>
            <li>
              <div>
                <b className="font-bold">A home network address while you are away from home.</b> Addresses like
                192.168… only work on that network.
              </div>
            </li>
            <li>
              <div>
                <b className="font-bold">A firewall that drops the connection</b> rather than refusing it.
              </div>
            </li>
            <li>
              <div>
                <b className="font-bold">A server still indexing the chain.</b> Fulcrum does not answer until its
                first sync is done.
              </div>
            </li>
          </Steps>
        </>
      ),
      more: certificate,
    },
    "not-electrum": {
      title: "Something answered, but it is not an Electrum server",
      body: (
        <p className="m-0">
          A service at <span className="font-mono text-[0.86em]">{h}</span> accepted the connection and did not speak the
          Electrum protocol. Check that the port is your Electrum server's WebSocket port and not, say, a web server or
          bitcoind's RPC port. Fulcrum and ElectrumX serve WebSocket; electrs does not, so run the local container with{" "}
          <span className="font-mono text-[0.86em]">ELECTRUM=host:port</span> set to its TCP port.
        </p>
      ),
    },
    "not-esplora": {
      title: "Something answered, but it is not an Esplora API",
      body: (
        <p className="m-0">
          A web server at <span className="font-mono text-[0.86em]">{h}</span> answered, but{" "}
          <span className="font-mono text-[0.86em]">{url.replace(/\/+$/, "")}/blocks/tip/hash</span> did not give a block
          hash. Check that the address is the API's own and not the explorer's page. It often ends in{" "}
          <span className="font-mono text-[0.86em]">/api</span>.
        </p>
      ),
    },
    cors: {
      title: "Your server answered, but did not let this app read it",
      body: (
        <>
          <p className="m-0">
            A browser only lets a page read an answer from another site when that site allows it, with an{" "}
            <span className="font-mono text-[0.86em]">Access-Control-Allow-Origin</span> header naming the page. Your
            server at <span className="font-mono text-[0.86em]">{h}</span> did not name this app, which is at{" "}
            <span className="font-mono text-[0.86em]">{location.origin}</span>. Esplora does not send the header unless
            told to.
          </p>
          <Steps>
            <li>
              <div>
                <b className="font-bold">If you run electrs yourself,</b> start it with{" "}
                <Url>--cors {location.origin}</Url>
              </div>
            </li>
            <li>
              <div>
                <b className="font-bold">If a web server sits in front of it,</b> as on most node packages, add the
                header there. For nginx, in the block that serves the API:{" "}
                <Url>add_header Access-Control-Allow-Origin "{location.origin}" always;</Url>
              </div>
            </li>
            <li>
              <div>
                <b className="font-bold">Come back here and choose Retry connection.</b>
              </div>
            </li>
          </Steps>
        </>
      ),
      more: (
        <p className="m-0">
          If your node package gives no way to change this, connect to its Electrum server over WebSocket instead.
        </p>
      ),
    },
  };
  const guide =
    failure && failure !== "invalid-url"
      ? guides[failure]
      : { title: "The connection failed", body: <p className="m-0">The browser reported: {message}</p>, more: certificate };
  return (
    <section aria-live="polite" className="overflow-hidden rounded-panel border border-[color-mix(in_srgb,var(--bad)_40%,var(--rule))] bg-sheet">
      <div className="flex items-start gap-2.5 bg-bad-tint px-4 py-3.5 text-bad">
        <Icon name="warn" className="mt-0.5 size-5" />
        <h2 className="m-0 text-md font-bold">{guide.title}</h2>
      </div>
      <div className="grid gap-3.5 p-4 text-ink-2 [&_p]:max-w-[62ch]">
        {guide.body}
        {guide.more && <div className="grid gap-2 border-t border-rule pt-3.5 text-sm">{guide.more}</div>}
      </div>
    </section>
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
          {connection.phase === "connected" ? `Connected to ${hostText(connection.url)}` : `Reconnecting to ${hostText(connection.url)}`}
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
                Asks for a new block every {POLL_SECONDS} seconds. Esplora cannot announce a payment, so one still in the
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
      .then((bridge: { url?: unknown }) => typeof bridge.url === "string" && setUrl((u) => u || new URL("electrum", location.href).href.replace(/^http/, "ws")))
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
          This wallet talks only to a server you run. Nothing about your wallet is sent anywhere else.
        </Heading>
        <RouteLine connection={connection.phase === "failed" && !failed ? { phase: "idle" } : connection} />
      </div>
      <div className="grid items-start gap-6 @min-[900px]:grid-cols-[400px_minmax(0,1fr)] @min-[900px]:gap-12">
        <form onSubmit={submit} className="grid min-w-0 content-start gap-4" noValidate>
          <Field
            label="Server address"
            hint="An Electrum server as wss:// and its WebSocket Secure port, often 50004, or an Esplora API as its https:// address."
            error={invalid ? "Write it as wss://host:port, for example wss://node.example.com:50004, or as https://host/api." : undefined}
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
          {busy && <p className="m-0 text-sm text-ink-2" role="status">Connecting to {hostText(url)}. Waiting up to 10 seconds for an answer.</p>}
          <Button type="submit" variant="primary" wide disabled={busy || !url.trim()} icon={failed && !invalid ? "retry" : undefined}>
            {failed && !invalid ? "Retry connection" : busy ? "Connecting" : connection.phase === "connected" && connection.url === url.trim() ? "Reconnect" : "Connect"}
          </Button>
          <p className="m-0 text-sm text-ink-3">
            There is no default or public server. If yours is unreachable, this app does nothing rather than ask someone
            else.
          </p>
        </form>
        {failed && !invalid ? <Guidance failure={failed.failure} url={failed.url} message={failed.message} /> : <Status connection={connection} />}
      </div>
    </div>
  );
}
