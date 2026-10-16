import type { ReactNode } from "react";
import { Heading, Page } from "../app/layout";
import { Icon } from "../ui/icons";
import { LinkButton, Steps } from "../ui/kit";

function Doc({ title, lede, children }: { title: string; lede: string; children: ReactNode }) {
  return (
    <Page aside={<LinkButton onClick={() => history.back()}>Back</LinkButton>}>
      <article className="grid max-w-[68ch] gap-5 text-ink-2 [&_h2]:m-0 [&_h2]:mt-3 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-ink [&_p]:m-0 [&_strong]:font-semibold [&_strong]:text-ink">
        <Heading title={title}>{lede}</Heading>
        {children}
      </article>
    </Page>
  );
}

function Code({ children }: { children: string }) {
  return (
    <pre className="m-0 overflow-x-auto rounded-control border border-rule bg-sunk px-3 py-2.5 font-mono text-[0.86em] leading-relaxed text-ink">
      {children}
    </pre>
  );
}

const c = "font-mono text-[0.86em] text-ink";

export function Trust() {
  return (
    <Doc
      title="What this app can and cannot protect you from"
      lede="Read this before trusting a hosted copy with real money."
    >
      <ul className="m-0 grid list-none gap-4 p-0 [&_li]:grid [&_li]:grid-cols-[22px_1fr] [&_li]:gap-2.5">
        <li>
          <Icon name="warn" className="mt-0.5 size-5 text-bad" />
          <p>
            <strong>It cannot protect you from whoever controls the domain.</strong> They can serve different code to you
            than to everyone else. A malicious build could show you a receive address that is not yours, or quietly send
            your addresses somewhere. Nothing in a web page can rule that out.
          </p>
        </li>
        <li>
          <Icon name="check" className="mt-0.5 size-5 text-ok" />
          <p>
            <strong>It does protect you from code changing under you.</strong> After the first load a service worker pins
            the code. A new version is downloaded in the background but only runs when you choose to reload into it, or
            after every tab of the app has been closed. The running version is always shown.
          </p>
        </li>
        <li>
          <Icon name="check" className="mt-0.5 size-5 text-ok" />
          <p>
            <strong>It does protect you from leaking to third parties.</strong> The app makes no requests to anyone except
            the Electrum server you enter. There is no default server, no analytics, no CDN and no remote fonts, and a
            strict Content Security Policy enforces it.
          </p>
        </li>
        <li>
          <Icon name="check" className="mt-0.5 size-5 text-ok" />
          <p>
            <strong>It does protect your history at rest.</strong> Wallet data in the browser is encrypted with a key
            derived from your passphrase (Argon2id, AES-GCM).
          </p>
        </li>
        <li>
          <Icon name="check" className="mt-0.5 size-5 text-ok" />
          <p>
            <strong>Your signer protects your keys.</strong> The app never sees them. Check the addresses and amounts on
            your signer's own screen before you sign, and verify receive addresses on the signer when it matters.
          </p>
        </li>
      </ul>
      <p>
        For real money, prefer the local container or a copy whose hashes you have checked.{" "}
        <a className="font-medium text-route underline underline-offset-3" href="#/guide">
          How to run it yourself
        </a>
      </p>
    </Doc>
  );
}

export function Guide() {
  return (
    <Doc
      title="Reaching your node"
      lede="A browser will not open wss:// to a self-signed certificate, and an https:// page cannot open ws:// at all. Two ways through."
    >
      <h2>Tailscale, from any device</h2>
      <p>Tailscale gives your node a real certificate on a private name, reachable from any of your devices with no port forwarding.</p>
      <Steps>
        <li>
          <p>Install Tailscale on the node and on your devices, and enable HTTPS certificates in the Tailscale admin console.</p>
        </li>
        <li>
          <div className="grid gap-2">
            <p>On the node, issue a certificate for its name:</p>
            <Code>tailscale cert node.your-tailnet.ts.net</Code>
          </div>
        </li>
        <li>
          <div className="grid gap-2">
            <p>
              Point Fulcrum at it and open a secure WebSocket port, in <span className={c}>fulcrum.conf</span>:
            </p>
            <Code>{`wss = 0.0.0.0:50004\ncert = /path/to/node.your-tailnet.ts.net.crt\nkey = /path/to/node.your-tailnet.ts.net.key`}</Code>
          </div>
        </li>
        <li>
          <p>
            Restart Fulcrum and connect the wallet to <span className={c}>wss://node.your-tailnet.ts.net:50004</span>.
          </p>
        </li>
      </Steps>
      <p>
        Tailscale certificates last 90 days. Re-run <span className={c}>tailscale cert</span> and restart Fulcrum before they
        expire, for example from a monthly cron job.
      </p>

      <h2>The local container, at home</h2>
      <p>
        The container serves the built app on <span className={c}>http://localhost:8080</span>. A localhost page is a secure
        context that may open plain ws://, so it reaches a node on your own network without a certificate. It also pins
        the code you run to a commit you chose.
      </p>
      <Code>{`docker build --build-arg GIT_COMMIT=$(git rev-parse --short HEAD) -t btc-browser-wallet .\ndocker run --rm -p 127.0.0.1:8080:8080 btc-browser-wallet`}</Code>
      <p>
        Then open <span className={c}>http://localhost:8080</span> and connect to <span className={c}>ws://</span> and your
        node's WebSocket port, for example <span className={c}>ws://192.168.1.20:50003</span>.
      </p>
    </Doc>
  );
}
