# VS Code Agents Instructions

This file provides instructions for AI coding agents working with the VS Code codebase.

For detailed project overview, architecture, coding guidelines, and validation steps, see the [Copilot Instructions](.github/copilot-instructions.md).

## Repository Branch Workflow

This repository separates upstream sync from stable integration.

- `sync-main` is the upstream-sync branch.
- A GitHub Action may rebase `sync-main` onto upstream and force-push rewritten history.
- `sync-main` should stay as close as possible to `upstream/main` and should not carry private feature or integration commits.
- `main` is the stable integration branch and should not be rewritten by the sync workflow.
- Do not do day-to-day development directly on `sync-main` or `main`.
- Do not open implementation PRs from `sync-main`.

Use this branch model instead:

- Create or refresh `sync-main` from `upstream/main` when needed.
- Create a `dev` branch from the latest `main` for ongoing local development.
- Create short-lived feature branches from `dev` when needed.
- Rebase `dev` or the feature branch onto the latest `sync-main` or `main` before merging changes back.
- Merge reviewed work into `main` only after the branch has been rebased onto the latest `sync-main`.

When updating local `sync-main`, do not use a regular `git pull`, because the remote `sync-main` history may have been rewritten.

Preferred update flow for local `sync-main`:

```bash
git checkout sync-main
git fetch origin
git reset --hard origin/sync-main
```

If local `sync-main` contains unpublished commits, preserve them on another branch before resetting.

Agent rules:

- Treat `sync-main` as a read-only sync target unless the user explicitly asks to work on it.
- Prefer working on `dev` or another non-`main`/non-`sync-main` branch.
- Before editing code, confirm the current branch is appropriate for the task.
- If the branch is `main` or `sync-main` and the task is normal feature work, stop and warn the user before proceeding.
- Do not resolve divergent `sync-main` history with a merge commit.
- If `sync-main` diverges from `origin/sync-main`, prefer `fetch` plus explicit reset or user confirmation, not `pull`.
