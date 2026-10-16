# Design directions

Three directions for the same four screens: Connect, Home, Send, Sign. Open
each `index.html` straight from disk. The bar at the top switches screen,
phone and desktop frames, light and dark, and the screen's state (the
certificate failure, the scan-back step). Coins are clickable and the fee,
change and privacy panel update live. All wallet data is made up. The QR
codes are patterns that look like QR codes; they do not decode.

All three use the same amount format: BTC with the decimals grouped as sats
(`0.12 000 000`), leading zeros dimmed, tabular figures. Fees in sats and
sat/vB. Each embeds its real font so you see it as it would ship.

## survey (recommended)

An Ordnance Survey sheet. Map paper, a navy legend bar, magenta for selection
and routes, a pale territory tint per source of coins. The privacy panel is a
small map: each source is a region, and the coins you picked are joined by a
dashed route, so "links 3 sources" is something you see. The coin list wears
the same shapes as the map key. The fee picker is the mempool drawn as a
cross-section with "You are here". Light first, with a night-map dark.
Font: Barlow Semi Condensed, `@fontsource/barlow-semi-condensed`, 3 weights,
about 67 KB.

## whitepaper

The 2008 Bitcoin paper. Black serif on white, booktabs tables, and one red
used only for warnings. Sources are told apart by print hatching, not colour,
so it works in monochrome and for colour-blind users. The privacy panel is
"Figure 1": the coins you picked in hatched boxes, arrows into one
transaction, and a caption saying what it links. Desktop has a contents
sidebar like a paper. Font: Source Serif 4,
`@fontsource-variable/source-serif-4`, about 51 KB.

## graphite

A dark working surface close to what Sparrow users already know. Graphite,
hairline seams, no shadows, one accent colour per source. Each source is a
lane down the side of the coin list, and the lanes you pick from bend into
one line marked "3 sources merge here". Desktop keeps three panels open
(Coins, Payment, Review); phone switches between them with a sticky footer.
Font: Recursive, `@fontsource-variable/recursive`, with its mono axis for
amounts and addresses. The full variable file is about 300 KB.

## Recommendation: survey

- It makes the feature the product is built on the easiest thing to read. A
  map is the natural picture of "these were separate and now they are
  joined", and the same key runs from the coin list to the map, so the user
  learns it once.
- Colour does a job. In graphite, colour does the same job, but on a dark
  screen full of mono figures the lanes have more competition. In
  whitepaper, hatching is honest and accessible but small hatches are hard
  to tell apart at phone size.
- It reads well on a phone in daylight, which is where a browser wallet
  earns its place over Sparrow. The condensed face fits value, age and
  confirmations on one row at 390 px.
- Smallest font cost of the three.

Honest risks: the territory shapes must be generated for any number of
sources and still look deliberate; the map metaphor could feel playful to
someone who wants a plain tool (graphite is the answer to that); and on
desktop the pinned summary covers the end of the privacy text until you
scroll, which needs fixing in the build.

`DESIGN.md` at the repo root holds the tokens and components for survey. If
you pick another direction, that file gets rewritten from its prototype.

## How the directions were chosen

Seven worlds from what this audience knows, ranked: the Bitcoin whitepaper,
numismatic coin trays, Ordnance Survey maps, registered airmail, printed PGP
source books, bank statements, banknote printing. A random draw (Impeccable
concept seed `62d420f8`) assigned the third, which became survey.
Whitepaper was my own top pick. Six outside worlds were weighed against
survey; a dark developer console held up on audience fit and became
graphite. The rest were declined, and survey took one discipline from three
of them:

- Split-flap departure board: values change in place and columns never
  reflow.
- Lexicon colour plates: colour appears only where it means something.
- Zoo guide map: one shape per source used everywhere.

Not interviewed: the product facts in `PRODUCT.md` were inferred from the
spec, since nobody was around to confirm them.
