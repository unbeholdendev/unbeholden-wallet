# Issue tracker: Forgejo (via MCP)

Issues and specs for this repo live in Forgejo at
`https://git.unbeholden.dev/unbeholden/btc-browser-wallet`.

There is no `gh` or `glab` equivalent here. All operations go through the
`forgejo` MCP connector, whose tools are deferred: load a schema with
`ToolSearch` (`select:mcp__forgejo__create_issue`) before calling it.

Owner is `unbeholden`, repo is `btc-browser-wallet`. Both are required parameters on
nearly every call.

## Conventions

- **Create an issue**: `mcp__forgejo__create_issue` with `owner`, `repo`,
  `title`, `body`.
- **Read an issue**: `mcp__forgejo__get_issue_by_index`, plus
  `mcp__forgejo__list_issue_comments` for the discussion.
- **List issues**: `mcp__forgejo__list_repo_issues`.
- **Comment**: `mcp__forgejo__create_issue_comment`.
- **Apply / remove labels**: `mcp__forgejo__add_issue_labels` /
  `mcp__forgejo__remove_issue_labels`.
- **Close**: `mcp__forgejo__issue_state_change`.
- **List / create labels**: `mcp__forgejo__list_repo_labels` /
  `mcp__forgejo__create_repo_label`.

## Known quirks

These cost time if rediscovered each session.

- **Labels are applied by numeric ID, not name.** `add_issue_labels` and
  `remove_issue_labels` take label IDs despite the parameter being called
  `labels`. Get the ID from `list_repo_labels` or from the `create_repo_label`
  response. Passing a name fails with a `ParseInt` error.
- **`list_repo_labels` fails with `include_org_labels` at its default.** The
  token lacks `read:organization`, so the org-label merge 403s. Pass
  `include_org_labels: false`.
- **`get_my_user_info` fails.** The token lacks `read:user`. Repo-scoped
  operations are unaffected.
- **Git pushes** use a per-host credential helper configured in
  `/root/.gitconfig` under `credential.https://git.unbeholden.dev.helper`. A
  missing credential presents as `Repository not found`, because the repo is
  private, not as an auth error.

## PRs as a request surface

**No.** _(Set to `yes` if this repo treats external PRs as feature requests;
`/triage` reads this flag.)_

## When a skill says "publish to the issue tracker"

Create a Forgejo issue with `mcp__forgejo__create_issue`.

A spec covering a whole release is an **epic**, not a work item. Publish it as
one issue labelled `epic`, then break it into children that each have their own
scope and a checkable "done when". Only the children carry `ready-for-agent`,
and only those whose blockers are already closed.

## When a skill says "fetch the relevant ticket"

`mcp__forgejo__get_issue_by_index`, then
`mcp__forgejo__list_issue_comments` for the same index.

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
