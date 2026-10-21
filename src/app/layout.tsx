import { useState, type ReactNode } from "react";
import { APP_VERSION } from "../pwa/register";
import { Icon, Mark } from "../ui/icons";
import { linkClass } from "../ui/kit";

/** A standalone page outside the app shell: onboarding, unlock, and the guides. */
export function Page({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="@container min-h-dvh bg-paper">
      <div className="mx-auto grid w-full max-w-[1040px] gap-8 px-4 pt-6 pb-10 @min-[720px]:px-12 @min-[720px]:pt-10">
        <header className="flex items-center justify-between gap-4">
          <a href="#/" className="flex items-center gap-2.5 text-md font-bold text-ink no-underline">
            <Mark />
            Unbeholden Wallet
          </a>
          {aside}
        </header>
        <InstallPrompt />
        {children}
        <Footer />
      </div>
    </div>
  );
}

export function Footer() {
  return (
    <footer className="flex flex-wrap gap-x-4 gap-y-1 border-t border-rule pt-4 text-sm text-ink-3">
      <span>Version {APP_VERSION}</span>
      <a className={linkClass} href="#/trust">
        What this app can and cannot protect you from
      </a>
      <a className={linkClass} href="#/guide">
        Reaching your node
      </a>
      <a className={linkClass} href="https://wallet.unbeholden.dev/">
        About
      </a>
    </footer>
  );
}

export function Heading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="grid gap-2">
      <h1 className="m-0 text-xl font-bold tracking-[-0.01em] text-balance text-ink">{title}</h1>
      {children && <p className="m-0 max-w-[52ch] text-ink-2">{children}</p>}
    </div>
  );
}

export const isIos = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

const standalone = () =>
  matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

const DISMISSED = "install-prompt-dismissed";

function readDismissed() {
  try {
    return localStorage.getItem(DISMISSED) === "1";
  } catch {
    return false;
  }
}

/** iOS Safari only: WebKit evicts a site's storage after seven days without a visit unless it is on the home screen. */
export function InstallPrompt() {
  const [hidden, setHidden] = useState(() => !isIos() || standalone() || readDismissed());
  if (hidden) return null;
  const dismiss = () => {
    try {
      localStorage.setItem(DISMISSED, "1");
    } catch {
      // Private browsing: the prompt comes back next visit, which is fine.
    }
    setHidden(true);
  };
  return (
    <aside className="flex items-start gap-3 rounded-panel border border-warn/40 bg-warn-tint px-4 py-3 text-sm text-warn">
      <Icon name="share" className="mt-0.5 size-5" />
      <div className="grid flex-1 gap-1">
        <p className="m-0 font-bold">Add this app to your Home Screen</p>
        <p className="m-0 text-ink">
          Safari deletes this site's stored data after seven days without a visit, and that includes your encrypted
          wallets. An app on the Home Screen is kept. Tap Share, then Add to Home Screen.
        </p>
      </div>
      <button type="button" onClick={dismiss} aria-label="Dismiss" className="-m-1 grid size-8 flex-none place-items-center rounded-control hover:bg-[color-mix(in_srgb,var(--warn)_12%,transparent)]">
        <Icon name="close" />
      </button>
    </aside>
  );
}
