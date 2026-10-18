# Design: Survey

The wallet looks like an Ordnance Survey sheet: map paper, a navy legend bar,
one magenta for routes and selection, and a pale territory tint for each
source of coins. The map lends type, palette, density and one signature move.
Navigation, controls and layout are ordinary web app ones.

Prototype: `docs/design/variants/survey/index.html`. Chosen over two other
directions, whitepaper and graphite, which git history keeps.

## Rationale

- The product's one distinct claim is "this selection links these sources".
  A map is the native picture of linkage: regions, borders, a route across
  them. The privacy panel draws it and the coin list wears the same shapes,
  so the user learns one key and reads it everywhere.
- Colour is quarantined. Territory tints appear only where they mean a source.
  Magenta means route: selection, the primary action, the current tab. State
  colours (ok, warn, bad) mean state. Everything else is ink on paper.
- Light is primary: checking a balance on a phone in daylight, or a desk by a
  window. Dark is a night map, same roles, every token redefined.
- Barlow Semi Condensed fits a BTC amount, its age and its confirmations on
  one 390 px row and has tabular figures.

## Amounts

- BTC with the eight decimals grouped as sats: `0.12 000 000`. Sparrow users
  already read this. Leading zeros take `ink-3`, so the significant digits
  stand out without changing width.
- Fees in sats (`1 662 sats`) and rates in sat/vB (`6 sat/vB`).
- Every number uses `tabular-nums`. Columns never reflow when values change;
  a changed summary value flashes once instead.
- No fiat anywhere.

## Tokens

Paste into `src/index.css`. Fonts come from `@fontsource/barlow-semi-condensed`
(weights 400, 500, 600), bundled by Vite and served from the app's own origin.

```css
@import "tailwindcss";
@import "@fontsource/barlow-semi-condensed/400.css";
@import "@fontsource/barlow-semi-condensed/500.css";
@import "@fontsource/barlow-semi-condensed/600.css";

@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));

:root {
  --paper: #f5f3ec; --sheet: #fffefa; --sunk: #eeebe1;
  --ink: #1b2a2e; --ink-2: #445356; --ink-3: #5a686b;
  --rule: #dcd7ca; --rule-2: #c6bfad;
  --legend: #163847; --legend-ink: #f2eee3; --legend-ink-2: #afc4cd;
  --legend-rule: #2b5062; --legend-hi: #23495b;
  --route: #ad1a68; --route-ink: #ffffff; --route-tint: #f8e6ef; --route-tint-2: #ebc3d7;
  --contour: #a8642a; --relief: #efe5d0; --relief-2: #e3d3b2;
  --ok: #2b7238; --ok-tint: #e1efdd;
  --warn: #7f5300; --warn-tint: #fbebc6;
  --bad: #a8261d; --bad-tint: #f8dfda;
  --src-1: #d2e7f1; --src-1-edge: #2b78a0;
  --src-2: #d5e8c2; --src-2-edge: #4a812f;
  --src-3: #f1e1b4; --src-3-edge: #8f6410;
  --src-4: #e7dbf1; --src-4-edge: #74509e;
  --src-5: #cde9e1; --src-5-edge: #267a6a;
  --src-6: #f5d5cc; --src-6-edge: #a84434;
  --src-none: #e5e2da; --src-none-edge: #6f6c64;
  --elevation: 0 1px 2px rgb(27 42 46 / 0.06), 0 6px 18px -6px rgb(27 42 46 / 0.14);
  color-scheme: light;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --paper: #0f171a; --sheet: #152125; --sunk: #0b1215;
    --ink: #e9e6dc; --ink-2: #b5bfbe; --ink-3: #95a2a2;
    --rule: #26363a; --rule-2: #36494e;
    --legend: #0a2230; --legend-ink: #edeae0; --legend-ink-2: #98b2be;
    --legend-rule: #1e3d4d; --legend-hi: #143447;
    --route: #f06bae; --route-ink: #22091a; --route-tint: #3a1a2b; --route-tint-2: #5c2745;
    --contour: #d49559; --relief: #2a261c; --relief-2: #3a3324;
    --ok: #82c98d; --ok-tint: #17301d;
    --warn: #e6b95a; --warn-tint: #33280f;
    --bad: #f2948a; --bad-tint: #3b1b18;
    --src-1: #17394a; --src-1-edge: #74badd;
    --src-2: #1f3b1b; --src-2-edge: #8cc56e;
    --src-3: #3a3014; --src-3-edge: #ddb258;
    --src-4: #2f2541; --src-4-edge: #b99dde;
    --src-5: #133a33; --src-5-edge: #66c5af;
    --src-6: #41231d; --src-6-edge: #ec9483;
    --src-none: #2a2926; --src-none-edge: #a3a096;
    --elevation: 0 1px 2px rgb(0 0 0 / 0.3), 0 8px 20px -8px rgb(0 0 0 / 0.5);
    color-scheme: dark;
  }
}

/* Same values as the media query: an explicit choice beats the system. */
:root[data-theme="dark"] {
  --paper: #0f171a; --sheet: #152125; --sunk: #0b1215;
  --ink: #e9e6dc; --ink-2: #b5bfbe; --ink-3: #95a2a2;
  --rule: #26363a; --rule-2: #36494e;
  --legend: #0a2230; --legend-ink: #edeae0; --legend-ink-2: #98b2be;
  --legend-rule: #1e3d4d; --legend-hi: #143447;
  --route: #f06bae; --route-ink: #22091a; --route-tint: #3a1a2b; --route-tint-2: #5c2745;
  --contour: #d49559; --relief: #2a261c; --relief-2: #3a3324;
  --ok: #82c98d; --ok-tint: #17301d;
  --warn: #e6b95a; --warn-tint: #33280f;
  --bad: #f2948a; --bad-tint: #3b1b18;
  --src-1: #17394a; --src-1-edge: #74badd;
  --src-2: #1f3b1b; --src-2-edge: #8cc56e;
  --src-3: #3a3014; --src-3-edge: #ddb258;
  --src-4: #2f2541; --src-4-edge: #b99dde;
  --src-5: #133a33; --src-5-edge: #66c5af;
  --src-6: #41231d; --src-6-edge: #ec9483;
  --src-none: #2a2926; --src-none-edge: #a3a096;
  --elevation: 0 1px 2px rgb(0 0 0 / 0.3), 0 8px 20px -8px rgb(0 0 0 / 0.5);
  color-scheme: dark;
}

@theme inline {
  --color-*: initial;
  --color-paper: var(--paper);
  --color-sheet: var(--sheet);
  --color-sunk: var(--sunk);
  --color-ink: var(--ink);
  --color-ink-2: var(--ink-2);
  --color-ink-3: var(--ink-3);
  --color-rule: var(--rule);
  --color-rule-2: var(--rule-2);
  --color-legend: var(--legend);
  --color-legend-ink: var(--legend-ink);
  --color-legend-ink-2: var(--legend-ink-2);
  --color-legend-rule: var(--legend-rule);
  --color-legend-hi: var(--legend-hi);
  --color-route: var(--route);
  --color-route-ink: var(--route-ink);
  --color-route-tint: var(--route-tint);
  --color-route-tint-2: var(--route-tint-2);
  --color-contour: var(--contour);
  --color-relief: var(--relief);
  --color-relief-2: var(--relief-2);
  --color-ok: var(--ok);
  --color-ok-tint: var(--ok-tint);
  --color-warn: var(--warn);
  --color-warn-tint: var(--warn-tint);
  --color-bad: var(--bad);
  --color-bad-tint: var(--bad-tint);
  --color-src-1: var(--src-1); --color-src-1-edge: var(--src-1-edge);
  --color-src-2: var(--src-2); --color-src-2-edge: var(--src-2-edge);
  --color-src-3: var(--src-3); --color-src-3-edge: var(--src-3-edge);
  --color-src-4: var(--src-4); --color-src-4-edge: var(--src-4-edge);
  --color-src-5: var(--src-5); --color-src-5-edge: var(--src-5-edge);
  --color-src-6: var(--src-6); --color-src-6-edge: var(--src-6-edge);
  --color-src-none: var(--src-none); --color-src-none-edge: var(--src-none-edge);
  --color-qr: #ffffff;
  --color-qr-ink: #101214;
  --color-white: #ffffff;
  --color-transparent: transparent;
  --color-current: currentColor;

  --shadow-*: initial;
  --shadow-float: var(--elevation);
}

@theme {
  --font-*: initial;
  --font-sans: "Barlow Semi Condensed", "Arial Narrow", system-ui, sans-serif;
  --font-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;

  --text-*: initial;
  --text-xs: 12px;   --text-xs--line-height: 1.35;
  --text-sm: 13px;   --text-sm--line-height: 1.4;
  --text-base: 15px; --text-base--line-height: 1.45;
  --text-md: 17px;   --text-md--line-height: 1.3;
  --text-lg: 21px;   --text-lg--line-height: 1.2;
  --text-xl: 28px;   --text-xl--line-height: 1.1;
  --text-2xl: 40px;  --text-2xl--line-height: 1;

  --font-weight-*: initial;
  --font-weight-normal: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;

  --spacing: 4px;

  --radius-*: initial;
  --radius-chip: 3px;
  --radius-check: 4px;
  --radius-control: 6px;
  --radius-panel: 8px;

  --ease-map: cubic-bezier(0.2, 0.8, 0.2, 1);
  --default-transition-duration: 160ms;
  --default-transition-timing-function: cubic-bezier(0.2, 0.8, 0.2, 1);
  --animate-route-draw: route-draw 500ms cubic-bezier(0.2, 0.8, 0.2, 1);
  --animate-value-flash: value-flash 600ms cubic-bezier(0.2, 0.8, 0.2, 1);

  @keyframes route-draw {
    from { stroke-dashoffset: var(--route-length, 200); }
    to { stroke-dashoffset: 0; }
  }
  @keyframes value-flash {
    from { background-color: var(--route-tint-2); }
    to { background-color: transparent; }
  }
}

@layer base {
  html { background: var(--paper); color: var(--ink); font-family: var(--font-sans); }
  body { font-size: var(--text-base); line-height: 1.45; font-variant-numeric: tabular-nums; }
  ::selection { background: var(--route-tint-2); color: var(--ink); }
  :focus-visible { outline: 2px solid var(--route); outline-offset: 2px; }
  * { scrollbar-width: thin; scrollbar-color: var(--rule-2) transparent; }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation: none !important; transition: none !important; }
  }
}
```

Notes on the tokens:

- Spacing steps in use: 1, 2, 3, 4, 6, 8, 12 (4 to 48 px). Panel padding 4
  (16 px), page gutter 6 (24 px) on desktop and 4 on phone.
- Sources get `src-1` to `src-6` in the order the wallet first saw them, and
  `src-none` for frozen or unknown deposits. A seventh source reuses `src-1`
  with a dashed edge.
- QR colours are fixed in both themes. Scanners read dark on light.
- Text contrast: `ink-3` is the lightest text colour and passes 4.5:1 on
  `paper` and `sheet` in both themes. Do not set text in `rule` colours.
- Shadow only on surfaces that float: menus, the phone summary dock, the
  pinned desktop summary. Panels sit flat with a 1 px `rule` border.

## Layout and navigation

**Desktop (720 px container and up).** A 56 px `legend` bar across the top:
wallet switcher on the left (name, script type, network badge for signet and
regtest), then tabs Home, Send, Receive, Coins, Addresses, with a 3 px
`route` underline on the current one. Connection status and Lock on the
right. Content sits on `paper` in `sheet` panels, 24 px gutter.

- Home: balance panel left (confirmed large, unconfirmed and frozen beneath,
  sync line), history panel right, a Sources key under the balance.
- Send: two columns. Left about 60 %: Pay to, then the coin table grouped by
  source. Right: What this links (the map and the sentence), then the
  summary pinned to the bottom of the column with Review and sign.
- Sign: three steps across the top (show to signer, scan back, broadcast),
  QR or viewfinder centre, controls to the side.

**Phone (under 720 px).** The `legend` bar shrinks to wallet switcher, tip
height and Lock. A 56 px `legend` tab bar at the bottom: Home, Send,
Receive, Coins. Everything is one column.

- Send: Pay to, then coins grouped by source, full width rows with 44 px tap
  targets. A summary dock sticks above the tab bar: coin count, inputs, fee,
  change, a "Links 3 sources" chip that scrolls to the map, and Review.
- The map sits below the coin list. The dock's chip is the shortcut to it.

Layout follows container width (`@container`), not the window, so a panel
can move without a rewrite.

## Components

| Component | Notes and states |
|---|---|
| Legend bar | Desktop top bar and phone top bar. Current tab: `legend-ink` text, `route` underline. |
| Tab bar (phone) | Four items, icon and label. Current: `legend-ink`, icon stroke `route-tint-2`. |
| Wallet switcher | `<details>` menu on `sheet` with `float` shadow. Rows: name, script type, network badge. Current row `route-tint`. Regtest and signet badges in `warn`. |
| Connection status | Dot and text: connected (`ok`), connecting (`warn`, text says what it is doing), disconnected (`bad`). Always names the server and tip height. |
| Button | Default: `sheet`, `rule-2` border. Primary: `route` fill, `route-ink` text, one per screen. Small: 13 px. Disabled: `rule` fill, `ink-3`. Hover darkens 12 %. Destructive (Remove wallet, Discard): default style with `bad` text, set apart by space. |
| Link button | `route`, underlined 1 px at 3 px offset. |
| Input | 44 px min height, `rule-2` border, `route` focus outline. Error: `bad` border plus a hint line that names the problem. Valid address: `ok` hint with a tick. |
| Chip | 12 px, 3 px radius. Variants: neutral, ok, warn, bad, route. Used for "Links 3 sources", "Own change", "From someone else, can still be replaced", "Frozen", "Replaceable". |
| Amount | Tabular, leading zeros `ink-3`, unit at 0.62 em in `ink-3`. Incoming `ok`, outgoing `ink` with a minus sign. |
| Balance panel | Confirmed at `text-2xl`; unconfirmed and frozen as rows below; sync line at the foot. |
| History row | Label, date, confirmations ("unconfirmed", "2 conf", "3 309 conf"), signed amount. Unconfirmed outgoing: Replaceable chip and Bump fee. Unconfirmed incoming from others: warn chip. Hover `sunk`. |
| Source group header | Territory chip (the source's shape at 22 px), name, what it means ("Exchange with your identity on file"), coin count, total. Background is the source tint. |
| Coin row | Checkbox, value, age, confirmations, label. Selected: `route-tint` row, filled `route` checkbox. Frozen: lock icon, `ink-3`, not selectable. Own change unconfirmed: chip, selectable. From others unconfirmed: warn chip, selectable with a warning. Unconfirmed parents: excluded, says why. |
| Linkage map | One territory per source (the same shape as its chip), tinted fill and darker edge. Coins are dots; selected dots are `route`. Dashed `route` lines run from each selected coin to a "This transaction" mark. Unlinked territories fade. Lines that are new draw in over 500 ms. The sentence below names the sources and who already knows the user's identity. When one cheaper-to-privacy alternative exists, a button offers it ("Use only Kraken and Payroll coins"). |
| Fee chart | Mempool from the node as a cross-section: fee rate on a log scale up, MvB of transactions ahead along. Contour lines at 2, 5, 10, 20, 50 sat/vB in `contour`, ground in `relief`. A "You are here" mark at the chosen rate. Presets beneath with rate and estimated wait, and a manual sat/vB stepper. |
| Summary | Coins in, sending, fee (sats, rate, vB), change with its derivation path, total leaving the wallet, RBF note. Values flash once on change. |
| Connection failure | Panel with `bad` header naming the cause. Numbered steps; for a rejected certificate: open the https URL in a new tab, check and accept the warning, expect a blank page, come back and retry. Then the Tailscale guide and the local container note. A route diagram shows where the connection broke. |
| QR export | White plate, dark modules, always. "Part 12 of 40" over a map scale bar of alternating segments, current part in `route`. Speed (2, 4, 6, 8 per second) and density (low, medium, high, with the part count each gives) as segmented controls. Save PSBT file as the fallback. |
| Scan back | Viewfinder with corner marks; a grid with one cell per part, filled as captured, in whatever order they arrive; "27 of 40 parts". Load signed file instead. |
| Verified | Checklist: outputs match, fee matches, all inputs signed. Broadcast through your node as the primary action. Node rejection shows the node's own reason. |

## Copy

British English. No em-dashes. Say what happened and what to do next.
"Your browser rejected this server's certificate", not "Connection error".
The privacy sentence always names the sources: "This spends coins from three
separate sources, permanently linking them: Kraken withdrawals, Bisq trade
#4417 and Northwind payroll."
