---
name: Unbeholden Wallet
description: Watch-only Bitcoin wallet that shows the case file a chain analyst would write before you sign.
colors:
  paper: "#fbfbf8"
  sheet: "#ffffff"
  sunk: "#f3f2ed"
  ink: "#111214"
  ink-2: "#45474d"
  ink-3: "#64666c"
  rule: "#e4e3dd"
  rule-2: "#cfcdc4"
  manila: "#e9dcb6"
  manila-2: "#f5eedb"
  manila-ink: "#5e4f22"
  carbon: "#2a3f9a"
  carbon-ink: "#ffffff"
  carbon-tint: "#edf0f9"
  carbon-hover: "#22337f"
  tamper: "#cf2330"
  tamper-ink: "#ffffff"
  ok: "#2c6a37"
  ok-tint: "#e5f0e3"
  warn: "#7c5300"
  warn-tint: "#faefd2"
  bad: "#a6271e"
  bad-tint: "#f9e3e0"
  check: "#8d9096"
  qr: "#ffffff"
  qr-ink: "#101214"
typography:
  display:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "40px"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "-0.01em"
    fontFeature: "tnum"
  headline:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1.1
  title:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 700
    lineHeight: 1.3
  body:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.45
    fontFeature: "tnum"
  small:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 700
    lineHeight: 1.35
  mono:
    fontFamily: "ui-monospace, SF Mono, Menlo, Consolas, monospace"
    fontSize: "0.86em"
rounded:
  chip: "3px"
  check: "4px"
  control: "6px"
  panel: "8px"
spacing:
  unit: "4px"
  panel: "16px"
  gutter-phone: "16px"
  gutter-desktop: "24px"
components:
  button-primary:
    backgroundColor: "{colors.carbon}"
    textColor: "{colors.carbon-ink}"
    rounded: "{rounded.control}"
    padding: "8px 16px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.carbon-hover}"
  button-default:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px 16px"
    height: "44px"
  button-default-hover:
    backgroundColor: "{colors.sunk}"
  button-danger:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.bad}"
    rounded: "{rounded.control}"
  button-small:
    padding: "4px 10px"
    height: "32px"
    typography: "{typography.small}"
  input:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
    height: "44px"
  panel:
    backgroundColor: "{colors.sheet}"
    rounded: "{rounded.panel}"
    padding: "16px"
  chip-neutral:
    backgroundColor: "{colors.sunk}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.chip}"
    typography: "{typography.label}"
    padding: "1px 8px"
  chip-join:
    backgroundColor: "{colors.tamper}"
    textColor: "{colors.tamper-ink}"
    rounded: "{rounded.chip}"
    typography: "{typography.label}"
    padding: "1px 8px"
  source-tag:
    backgroundColor: "{colors.manila}"
    textColor: "{colors.manila-ink}"
    height: "22px"
  source-tag-large:
    backgroundColor: "{colors.manila}"
    textColor: "{colors.manila-ink}"
    height: "26px"
  source-tag-picked:
    backgroundColor: "{colors.carbon}"
    textColor: "{colors.carbon-ink}"
  source-header:
    backgroundColor: "{colors.manila-2}"
    textColor: "{colors.manila-ink}"
    padding: "10px 16px"
  coin-row-selected:
    backgroundColor: "{colors.carbon-tint}"
    textColor: "{colors.ink}"
  tab-bar:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink-2}"
    height: "56px"
---

# Design: Exhibit

The wallet shows the case file a chain analyst would write about a
transaction before you hand it to them. Evidence-white paper, near-black ink,
manila tags on every source, carbon blue for what you chose, and tamper red
only where separate sources get joined. Navigation, controls and layout are
ordinary web app ones.

Prototype: `docs/design/variants/exhibit/index.html`. Exhibit replaced Survey,
the Ordnance Survey map direction, because Survey was too playful, a map worn
as a costume, and not distinctive enough. Git history keeps Survey's prototype.

## Rationale

- The product's one distinct claim is "this selection links these sources".
  An analyst's custody log is the native record of that: numbered entries,
  who already knows you, and the moment they get joined. The coin list, the
  custody log and the Sign recap all carry the same manila tag per source, so
  the user learns one mark and reads it everywhere.
- Colour is quarantined. Manila means a source: its tag and its group header.
  Carbon means your choice: selection, the one primary action, the current
  tab, focus. Tamper red appears only where sources get joined: the seam, the
  tape and the Joins chip. State colours (ok, warn, bad) mean state.
  Everything else is ink on paper.
- Light is primary: checking a balance on a phone in daylight, or a desk by a
  window. Dark has the same roles, every token redefined.
- Hanken Grotesk is a plain, firm grotesque with tabular figures, so a BTC
  amount, its age and its cost to spend fit one 390 px row and line up in
  columns. System mono only for addresses, outpoints and derivation paths.

## Amounts

- BTC with the eight decimals grouped as sats: `0.12 000 000`. Sparrow users
  already read this. Leading zeros take `ink-3` at weight 400, so the
  significant digits stand out without changing width.
- The BTC unit, when shown, is 0.62 em, bold, `ink-3`.
- Fees in sats (`1 662 sats`, grouped with a narrow no-break space) and rates
  in sat/vB (`6 sat/vB`).
- Signed amounts: incoming `ok` with `+`, outgoing `ink` with a true minus
  sign.
- Every number uses `tabular-nums`. Columns never reflow when values change;
  a changed summary value flashes `carbon-tint` once instead.
- No fiat anywhere.

## Tokens

The frontmatter above carries the light values for tools. This block is
`src/index.css` as built. Fonts come from `@fontsource/hanken-grotesk`
(Latin subset, weights 400, 500, 700), bundled by Vite and served from the
app's own origin.

```css
@import "tailwindcss";
@import "@fontsource/hanken-grotesk/latin-400.css";
@import "@fontsource/hanken-grotesk/latin-500.css";
@import "@fontsource/hanken-grotesk/latin-700.css";

@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));

:root {
  --paper: #fbfbf8; --sheet: #ffffff; --sunk: #f3f2ed;
  --ink: #111214; --ink-2: #45474d; --ink-3: #64666c;
  --rule: #e4e3dd; --rule-2: #cfcdc4;
  --manila: #e9dcb6; --manila-2: #f5eedb; --manila-ink: #5e4f22;
  --carbon: #2a3f9a; --carbon-ink: #ffffff; --carbon-tint: #edf0f9; --carbon-hover: #22337f;
  --tamper: #cf2330; --tamper-ink: #ffffff;
  --ok: #2c6a37; --ok-tint: #e5f0e3;
  --warn: #7c5300; --warn-tint: #faefd2;
  --bad: #a6271e; --bad-tint: #f9e3e0;
  --check: #8d9096;
  --elevation: 0 1px 2px rgb(17 18 20 / .06), 0 10px 24px -10px rgb(17 18 20 / .22);
  color-scheme: light;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --paper: #121317; --sheet: #191b20; --sunk: #0e0f12;
    --ink: #ecebe6; --ink-2: #b8b9bd; --ink-3: #9a9ca2;
    --rule: #2a2c33; --rule-2: #3a3d45;
    --manila: #6e5c2f; --manila-2: #29241a; --manila-ink: #f3e7c4;
    --carbon: #9aaeff; --carbon-ink: #10152e; --carbon-tint: #1d2340; --carbon-hover: #b6c4ff;
    --tamper: #c9353e; --tamper-ink: #ffffff;
    --ok: #86c891; --ok-tint: #17291b;
    --warn: #e8bc5e; --warn-tint: #2f2610;
    --bad: #ff8a80; --bad-tint: #3b1b18;
    --check: #6c6f77;
    --elevation: 0 1px 2px rgb(0 0 0 / .3), 0 12px 28px -10px rgb(0 0 0 / .6);
    color-scheme: dark;
  }
}

/* Same values as the media query: an explicit choice beats the system. */
:root[data-theme="dark"] {
  --paper: #121317; --sheet: #191b20; --sunk: #0e0f12;
  --ink: #ecebe6; --ink-2: #b8b9bd; --ink-3: #9a9ca2;
  --rule: #2a2c33; --rule-2: #3a3d45;
  --manila: #6e5c2f; --manila-2: #29241a; --manila-ink: #f3e7c4;
  --carbon: #9aaeff; --carbon-ink: #10152e; --carbon-tint: #1d2340; --carbon-hover: #b6c4ff;
  --tamper: #c9353e; --tamper-ink: #ffffff;
  --ok: #86c891; --ok-tint: #17291b;
  --warn: #e8bc5e; --warn-tint: #2f2610;
  --bad: #ff8a80; --bad-tint: #3b1b18;
  --check: #6c6f77;
  --elevation: 0 1px 2px rgb(0 0 0 / .3), 0 12px 28px -10px rgb(0 0 0 / .6);
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
  --color-manila: var(--manila);
  --color-manila-2: var(--manila-2);
  --color-manila-ink: var(--manila-ink);
  --color-carbon: var(--carbon);
  --color-carbon-ink: var(--carbon-ink);
  --color-carbon-tint: var(--carbon-tint);
  --color-carbon-hover: var(--carbon-hover);
  --color-tamper: var(--tamper);
  --color-tamper-ink: var(--tamper-ink);
  --color-ok: var(--ok);
  --color-ok-tint: var(--ok-tint);
  --color-warn: var(--warn);
  --color-warn-tint: var(--warn-tint);
  --color-bad: var(--bad);
  --color-bad-tint: var(--bad-tint);
  --color-check: var(--check);
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
  --font-sans: "Hanken Grotesk", system-ui, sans-serif;
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
  --font-weight-bold: 700;

  --spacing: 4px;

  --radius-*: initial;
  --radius-chip: 3px;
  --radius-check: 4px;
  --radius-control: 6px;
  --radius-panel: 8px;

  --ease-snap: cubic-bezier(0.2, 0.8, 0.2, 1);
  --default-transition-duration: 160ms;
  --default-transition-timing-function: cubic-bezier(0.2, 0.8, 0.2, 1);
  --animate-entry-in: entry-in 300ms cubic-bezier(0.2, 0.8, 0.2, 1);
  --animate-seam: seam 300ms cubic-bezier(0.2, 0.8, 0.2, 1);
  --animate-value-flash: value-flash 600ms cubic-bezier(0.2, 0.8, 0.2, 1);

  @keyframes entry-in {
    from { clip-path: inset(0 0 100% 0); }
    to { clip-path: inset(0); }
  }
  @keyframes seam {
    from { transform: scaleY(var(--from, 0)); }
    to { transform: scaleY(1); }
  }
  @keyframes value-flash {
    from { background-color: var(--carbon-tint); }
    to { background-color: transparent; }
  }
}

@layer base {
  html { background: var(--paper); color: var(--ink); font-family: var(--font-sans); -webkit-font-smoothing: antialiased; }
  body { font-size: var(--text-base); line-height: 1.45; font-variant-numeric: tabular-nums; }
  ::selection { background: var(--carbon-tint); color: var(--ink); }
  :focus-visible { outline: 2px solid var(--carbon); outline-offset: 2px; }
  * { scrollbar-width: thin; scrollbar-color: var(--rule-2) transparent; }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation: none !important; transition: none !important; }
  }
}

@keyframes march {
  to { stroke-dashoffset: -18; }
}

@keyframes toast-in {
  from { opacity: 0; transform: translateY(8px); }
}

@layer base {
  body { margin: 0; background: var(--paper); caret-color: var(--carbon); }
  button, input, select, textarea { font: inherit; color: inherit; }
  button { cursor: pointer; }
}
```

Notes on the tokens:

- Spacing is a 4 px unit. Panel padding 16 px; page gutter 16 px on a phone
  and 24 px from 720 px; 16 px between the panels of a screen, 24 px between
  page sections.
- Weights: 400 for body, 500 for values and emphasis inside a line, 700 for
  headings, labels, buttons, chips and tags. No 600.
- Text sizes: 12 (chips, tags, column headers), 13 (secondary lines), 15
  (body), 17 (panel titles, coin values), 21 (Coins heading), 28 (page
  titles, QR part counter), 40 (balance).
- `check` is the unticked checkbox border only, never text.
- QR colours are fixed in both themes. Scanners read dark on light.
- Text contrast: `ink-3` is the lightest text colour and passes 4.5:1 on
  `paper`, `sunk` and `manila-2` in light, and on `paper`, `sheet` and
  `manila-2` in dark. Do not set text in `rule` or `check`.
- Shadow only on surfaces that float: the wallet menu, the bottom sheet,
  toasts, and the phone docks on Send and Coins. Panels sit flat with a 1 px
  `rule` border.

## Mark

The air-gap U: a heavy U split at the base, the gap between the wallet and
the keys. `paper` (`#fbfbf8`) on a `carbon` (`#2a3f9a`) tile, 112/512 corner
radius. Fixed colours in both themes, like the QR plate. It is not drawn from
the source tags or the join colours; those mean things inside the app.

- On a 512 grid the arms are 96 wide at x 96 and 320, top at y 96, the bowl
  centred at (256, 272), the gap 64 wide. Every edge falls on the 32-unit
  pixel grid of a 16 px favicon.
- `public/icon.svg` is the source, copied to `site/public/icon.svg` and drawn
  inline by `Mark` in `src/ui/icons.tsx`. Change all three together.
- PNGs are screenshots of that SVG in Chromium: `icon-192` and `icon-512`
  as is; `apple-touch-icon` (180) on a square tile, since iOS rounds it;
  `icon-maskable-512` on a square tile with the U at 75 %, inside the safe
  circle.
- Lockup: the mark at 26 to 28 px, then "Unbeholden Wallet" in Hanken
  Grotesk bold, 10 px apart.

## Layout and navigation

**Desktop (app container 720 px and up).** A 56 px `sheet` top bar with a
`rule` hairline beneath: wallet switcher on the left (name, script type,
network badge for signet and regtest), then tabs Home, Send, Receive, Coins.
The current tab is bold `ink` with a 2 px `carbon` underline; the others are
`ink-2` at 500. Connection status, Settings and Lock on the right. Content on
`paper` in `sheet` panels, at most 1280 px wide.

- Home: balance panel, then transactions with search and filters.
- Send (two columns from 900 px): left is Pay to and amount, Fee, then Coins
  grouped by source. Right is a 440 px column that sticks under the top bar
  and scrolls on its own: Custody log, then Summary with Review and sign at
  its foot.
- Sign: the three steps as a segmented strip (show to signer, scan back,
  broadcast), the stage body on the left, and the recap in a 340 px column on
  the right at every stage.

**Phone (under 720 px).** The top bar keeps the wallet switcher, a short
status (tip height, or Connecting, or Offline), Settings and Lock. A 56 px
`sheet` tab bar at the bottom: Home, Send, Receive, Coins; the current item
has a 2 px `carbon` top edge, a `carbon` icon and a bold `ink` label.
Everything is one column.

- Send: Pay to, Fee, Coins, then Custody log and Summary. A dock sticks above
  the tab bar: coin count, amount in, fee, change, a "Joins 3 sources" chip
  that scrolls to the custody log, and Review.
- Sign: the recap follows the stage body.

Layout follows container width (`@container`), not the window, so a panel
can move without a rewrite.

## Components

| Component | Notes and states |
|---|---|
| Top bar | `sheet`, `rule` hairline below, 56 px, sticky. Square 40 px icon buttons for Settings and Lock, `rule-2` border. |
| Tab bar (phone) | Four items, icon over label, 56 px. Current: `carbon` top edge and icon, bold `ink` label. |
| Wallet switcher | `<details>` menu on `sheet` with `float` shadow and `rule-2` border. Rows: name, script type, network badge. Current row `carbon-tint`. Then Addresses and Add a wallet (`carbon`). |
| Network badge | 11 px bold capitals, `warn` on `warn-tint`. Signet and regtest only. |
| Connection status | Dot and text: connected (`ok`), connecting or retrying (`warn`, pulsing, says what it is doing), not connected (`bad`). Names the server and tip height. |
| Button | Bold, 6 px radius, 44 px tall. Default: `sheet`, `rule-2` border, hover `sunk`. Primary: `carbon` fill, `carbon-ink` text, hover `carbon-hover`, one per screen. Danger: default style with `bad` text, hover `bad-tint`. Small: 32 px, 13 px. Disabled: `rule` fill, `ink-3`. |
| Link button | Bold `carbon`, 1 px underline at 3 px offset, 2 px on hover. |
| Input | 44 px min height, `rule-2` border, `carbon` caret and 2 px focus outline. Error: `bad` border plus a hint line that names the problem. Valid: `ok` hint with a tick. |
| Segmented | Joined options in one `rule-2` box. Pressed: `carbon-tint`, bold `carbon`. Used for QR format, speed and density. |
| Chip | 12 px bold, 3 px radius. Tones: neutral, ok, warn, bad, carbon, join. Join is `tamper` fill with the join icon, and only ever says "Joins N". |
| Source tag | A manila luggage tag carrying the source's name: notched left point, a punched hole, bold text with 0.03 em tracking. 22 px small, 26 px large. `manila` on `manila-ink`; `carbon` once any of its coins is picked; `sunk` with `ink-3` when all its coins are frozen. Never a letter or a code. |
| Source group header | `manila-2` band, sticky under the top bar. Large source tag (editable label), the source's note ("First seen in block 812 044, already linked on-chain") and a "Knows who I am" switch, `warn-tint` when on. Right: picked count, total, Select all. |
| Coin row | Checkbox, value, age, label or mono address, cost to spend, History link, state chips. Hover a light `carbon-tint` wash; selected `carbon-tint` row, filled `carbon` checkbox. Not selectable: dashed checkbox, `ink-3` value. Frozen, own change, someone else's unconfirmed, waiting on an unconfirmed parent and uneconomic each get a chip. |
| Custody log | The signature. A 1 px `ink` rule over numbered entries (01, 02), one per source the picked coins come from: large source tag, "Knows who you are" or "Not marked as knowing who you are", coins picked, amount. With two or more entries a 3 px `tamper` seam runs down the numbers, and a `tamper` tape with diagonal stripes and notched ends reads "Joined in one transaction". A new entry unrolls over 300 ms and the seam extends to it. One entry: an `ok` note, "No new links". Below it the privacy sentence and, where one exists, a cheaper alternative with a button. |
| Fee panel | Mempool from the node as a cross-section: fee rate up, MvB ahead along, `sunk` fill, `rule-2` lines, a dashed `carbon` mark at the chosen rate. Presets as pressable cards (name, sat/vB, wait), and a sat/vB stepper. The chart folds away on a phone. |
| Summary | Coins in, sending, fee (sats, rate, vB), change with its mono derivation path, total leaving the wallet; dotted `rule-2` leaders between rows. Values flash once on change. |
| Steps | Numbered ink circles for instructions, as on the connection failure panel. |
| Notice | Tinted block with icon: `ok`, `warn` or `bad`. |
| Connection failure | `bad-tint` header naming the cause in `bad`, numbered steps, and a line from this tab to the server, dashed `carbon` where it reached and a `bad` cross where it broke. |
| QR export | White plate, dark modules, always. "Part 12 of 40" over a bar of alternating `ink` and `sheet` segments, current part `carbon`. Format, speed and density as segmented controls inside "Signer can't read it?". |
| Scan back | Viewfinder; "27 of 40 parts captured" over a ten-column grid, one cell per part, filled as captured in any order. Load signed file, under "No camera?". |
| Sign recap | `sheet` panel titled with the payment's label: sending, to (mono), fee, change, then the custody log as it stood when Review was pressed, without motion. Shown at every stage. |
| Verified | Checklist with `ok` ticks: outputs match, fee matches, all inputs signed. Broadcast through your node as the primary action. A node rejection shows the node's own reason in mono. |
| Empty | Dashed `rule-2` panel, title and one line of what to do. |

## Copy

British English. No em-dashes. Say what happened and what to do next.
"Your browser rejected this server's certificate", not "Connection error".
The privacy sentence always names the sources: "This spends coins from three
separate sources, permanently linking them: Kraken withdrawals, Bisq trade
#4417 and Northwind payroll."
