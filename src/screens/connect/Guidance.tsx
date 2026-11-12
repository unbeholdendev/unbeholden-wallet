import type { ReactNode } from "react";
import type { Failure } from "../../app/connection";
import { hostText } from "../../ui/format";
import { Icon } from "../../ui/icons";
import { buttonClass, linkClass, Steps } from "../../ui/kit";

const httpsForm = (url: string) => `https://${hostText(url)}/`;

function Url({ children }: { children: ReactNode }) {
  return (
    <span className="mt-1 inline-block rounded-[4px] bg-sunk px-2 py-1 font-mono text-[0.86em] break-all">
      {children}
    </span>
  );
}

const certificate = (
  <p className="m-0">
    To stop this happening on every device, give your server a certificate your browser trusts.{" "}
    <a className={linkClass} href="#/guide">
      How to get one
    </a>
  </p>
);

export function Guidance({ failure, url, message }: { failure: Failure | null; url: string; message: string }) {
  const h = hostText(url);
  const guides: Record<Exclude<Failure, "invalid-url">, { title: string; body: ReactNode; more?: ReactNode }> = {
    "certificate-rejected": {
      title: "The browser rejected this server's certificate",
      body: (
        <>
          <p className="m-0">
            Your server at <span className="font-mono text-[0.86em]">{h}</span> answered, but with a certificate this
            browser doesn't trust, usually because it's self-signed. WebSocket connections have no "proceed anyway"
            button, so you accept the certificate once in an ordinary tab.
          </p>
          <Steps>
            <li>
              <div>
                <b className="font-bold">Open the server's https address in a new tab.</b>
                <br />
                <Url>{httpsForm(url)}</Url>{" "}
                <a
                  className={`${buttonClass({ size: "sm" })} mt-1 align-middle`}
                  href={httpsForm(url)}
                  target="_blank"
                  rel="noreferrer"
                >
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
                <b className="font-bold">Expect a blank page or an error there.</b> That's normal. Close that tab.
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
      title: "This page can't open a plain ws:// or http:// connection",
      body: (
        <>
          <p className="m-0">
            This app was loaded over https, and browsers don't let an https page open an unencrypted ws:// or http://
            connection to another machine. There are two ways round it.
          </p>
          <Steps>
            <li>
              <div>
                <b className="font-bold">Give your server a certificate and use wss:// or https://.</b>{" "}
                <a className={linkClass} href="#/guide">
                  How to get one
                </a>
              </div>
            </li>
            <li>
              <div>
                <b className="font-bold">Or run this app from the local container.</b> It serves the app on{" "}
                <span className="font-mono text-[0.86em]">http://localhost:8080</span>, and a localhost page may open
                ws:// or http:// to a node on your own network.{" "}
                <a className={linkClass} href="#/guide">
                  How to run it
                </a>
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
          <p className="m-0">
            The address was reached, or looked up, but no service took the connection. Check, in order:
          </p>
          <Steps>
            <li>
              <div>
                <b className="font-bold">The server is running</b> and has finished starting up.
              </div>
            </li>
            <li>
              {/^https?:/.test(url) ? (
                <div>
                  <b className="font-bold">The port is the one your Esplora API listens on</b>, not the explorer's web
                  page if it serves that elsewhere.
                </div>
              ) : (
                <div>
                  <b className="font-bold">The port is the WebSocket one.</b> Fulcrum's TCP ports (50001, 50002) don't
                  speak WebSocket; the <span className="font-mono text-[0.86em]">ws</span> and{" "}
                  <span className="font-mono text-[0.86em]">wss</span> settings in fulcrum.conf name the right ports. A
                  server with only a TCP port, such as electrs, is reached through the local container.{" "}
                  <a className={linkClass} href="#/guide">
                    How to run it
                  </a>
                </div>
              )}
            </li>
            <li>
              <div>
                <b className="font-bold">Nothing between you blocks it:</b> a firewall on the node, or a router that
                doesn't forward the port.
              </div>
            </li>
            {/^(wss|https):/.test(url) && (
              <li>
                <div>
                  <b className="font-bold">A self-signed certificate can look exactly like this.</b> Open{" "}
                  <Url>{httpsForm(url)}</Url> in a new tab, accept the warning if it's about your own server, then come
                  back and retry.{" "}
                  <a
                    className={`${buttonClass({ size: "sm" })} mt-1 align-middle`}
                    href={httpsForm(url)}
                    target="_blank"
                    rel="noreferrer"
                  >
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
      title: `${h} didn't answer within 10 seconds`,
      body: (
        <>
          <p className="m-0">Nothing came back at all, which usually means this device can't reach that address:</p>
          <Steps>
            <li>
              <div>
                <b className="font-bold">A home network address while you're away from home.</b> Addresses like 192.168…
                only work on that network.
              </div>
            </li>
            <li>
              <div>
                <b className="font-bold">A firewall that drops the connection</b> rather than refusing it.
              </div>
            </li>
            <li>
              <div>
                <b className="font-bold">A server still indexing the chain.</b> Fulcrum doesn't answer until its first
                sync is done.
              </div>
            </li>
          </Steps>
        </>
      ),
      more: certificate,
    },
    bridge: {
      title: "The container couldn't reach your Electrum server",
      body: (
        <>
          <p className="m-0">
            This address is the container's bridge, on the same server as this page, so the browser already trusts it.
            The bridge passes the connection on to the server set in{" "}
            <span className="font-mono text-[0.86em]">ELECTRUM</span>, and that part failed. Check, in order:
          </p>
          <Steps>
            <li>
              <div>
                <b className="font-bold">The host and port are right, and reachable from the container.</b> Inside a
                container, <span className="font-mono text-[0.86em]">localhost</span> is the container itself, not the
                machine running it.
              </div>
            </li>
            <li>
              <div>
                <b className="font-bold">The scheme matches the port.</b> A TCP port such as 50001 is{" "}
                <span className="font-mono text-[0.86em]">ELECTRUM=host:50001</span>; an SSL port such as 50002 is{" "}
                <span className="font-mono text-[0.86em]">ELECTRUM=ssl://host:50002</span>.
              </div>
            </li>
            <li>
              <div>
                <b className="font-bold">Restart the container, then choose Retry connection.</b>
              </div>
            </li>
          </Steps>
        </>
      ),
    },
    "not-electrum": {
      title: "Something answered, but it's not an Electrum server",
      body: (
        <p className="m-0">
          A service at <span className="font-mono text-[0.86em]">{h}</span> accepted the connection and didn't speak the
          Electrum protocol. Check that the port is your Electrum server's WebSocket port and not, say, a web server or
          bitcoind's RPC port. Fulcrum and ElectrumX serve WebSocket; electrs doesn't, so run the local container with{" "}
          <span className="font-mono text-[0.86em]">ELECTRUM=host:port</span> set to its TCP port.
        </p>
      ),
    },
    "not-esplora": {
      title: "Something answered, but it's not an Esplora API",
      body: (
        <p className="m-0">
          A web server at <span className="font-mono text-[0.86em]">{h}</span> answered, but{" "}
          <span className="font-mono text-[0.86em]">{url.replace(/\/+$/, "")}/blocks/tip/hash</span> didn't give a block
          hash. Check that the address is the API's own and not the explorer's page. It often ends in{" "}
          <span className="font-mono text-[0.86em]">/api</span>.
        </p>
      ),
    },
    cors: {
      title: "Your server answered, but didn't let this app read it",
      body: (
        <>
          <p className="m-0">
            A browser only lets a page read an answer from another site when that site allows it, with an{" "}
            <span className="font-mono text-[0.86em]">Access-Control-Allow-Origin</span> header naming the page. Your
            server at <span className="font-mono text-[0.86em]">{h}</span> didn't name this app, which is at{" "}
            <span className="font-mono text-[0.86em]">{location.origin}</span>. Esplora doesn't send the header unless
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
      : {
          title: "The connection failed",
          body: <p className="m-0">The browser reported: {message}</p>,
          more: certificate,
        };
  return (
    <section
      aria-live="polite"
      className="overflow-hidden rounded-panel border border-[color-mix(in_srgb,var(--bad)_40%,var(--rule))] bg-sheet"
    >
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
