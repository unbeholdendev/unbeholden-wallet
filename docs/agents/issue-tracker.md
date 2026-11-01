# Issue tracker: Forgejo (via `tea`)

Issues and specs for this repo live in Forgejo at
`https://git.home.unbeholden.dev/unbeholden/unbeholden-wallet`.

`gh` and `glab` don't apply here. Use `tea` for every operation, from inside the
repo, and `tea api <path>` for what it lacks.

## External reports on GitHub

The public mirror is `https://github.com/unbeholdendev/unbeholden-wallet`, and
outsiders file issues there. Read them, never write: no token, so use the
public API, limited to 60 requests an hour.

    curl -s https://api.github.com/repos/unbeholdendev/unbeholden-wallet/issues
    curl -s https://api.github.com/repos/unbeholdendev/unbeholden-wallet/issues/<n>/comments

The issues endpoint also returns PRs; they carry a `pull_request` key. To act on
a report, open a Forgejo issue that links to it.

## Conventions

- **Create an issue**: `tea issues create --title <title> --description-file <file>`.
- **Read an issue**: `tea issues <index>`, plus
  `tea api repos/unbeholden/unbeholden-wallet/issues/<index>/comments` for the
  discussion.
- **List issues**: `tea issues list`.
- **Comment**: `tea comment <index> <body>`.
- **Apply / remove labels**: `tea issues edit <index> --add-labels <names>` /
  `--remove-labels <names>`.
- **Close**: `tea issues close <index>`.
- **List / create labels**: `tea labels list` /
  `tea labels create --name <name> --color <hex>`.

## Known quirks

These cost time if rediscovered each session.

- **Git pushes** use a per-host credential helper configured in
  `/root/.gitconfig` under `credential.https://git.home.unbeholden.dev.helper`. A
  missing credential presents as `Repository not found`, because the repo is
  private, not as an auth error.

## PRs as a request surface

**No.** _(Set to `yes` if this repo treats external PRs as feature requests;
`/triage` reads this flag.)_

## When a skill says "publish to the issue tracker"

Create a Forgejo issue with `tea issues create`.

A spec covering a whole release is an **epic**, not a work item. Publish it as
one issue labelled `epic`, then break it into children that each have their own
scope and a checkable "done when". Only the children carry `ready-for-agent`,
and only those whose blockers are already closed.

## When a skill says "fetch the relevant ticket"

`tea issues <index>`, then `tea api` on its `comments`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as
tickets.

Forgejo has neither GitHub's sub-issues nor native issue dependencies, so both
relationships are body-line conventions:

- **Map**: an issue labelled `wayfinder:map` holding the Notes /
  Decisions-so-far / Fog body.
- **Child ticket**: an issue with `Part of #<map>` at the top of its body, and
  a task-list entry in the map body. Labelled `wayfinder:<type>`
  (`research` / `prototype` / `grilling` / `task`). Assigned to the driving dev
  once claimed.
- **Blocking**: a `Blocked by: #<n>, #<n>` line at the top of the child body. A
  ticket is unblocked when every issue named there is closed. Nothing enforces
  this, so it has to be read.
- **Frontier query**: list the map's open children, drop any with an open
  issue in its `Blocked by` line or with an assignee; first in map order wins.
- **Claim**: assign the issue to yourself. The session's first write.
- **Resolve**: comment the answer, close the issue, then append a context
  pointer to the map's Decisions-so-far.
