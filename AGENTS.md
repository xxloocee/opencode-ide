# VS Code Agents Instructions

This file provides instructions for AI coding agents working with the VS Code codebase.

For detailed project overview, architecture, coding guidelines, and validation steps, see the [Copilot Instructions](.github/copilot-instructions.md).

## Repository Branch Workflow

This repository does not use `main` like a normal long-lived development branch.

- `main` is the upstream-sync branch.
- A GitHub Action may rebase `main` onto upstream and force-push rewritten history.
- Do not do day-to-day development directly on `main`.
- Do not open implementation PRs from `main`.

Use this branch model instead:

- Create a `dev` branch from the latest `main` for ongoing local development.
- Create short-lived feature branches from `dev` when needed.
- Rebase `dev` or the feature branch onto the latest `main` before merging changes back.
- Merge reviewed work into `main` only after the branch has been rebased onto the latest `main`.

When updating local `main`, do not use a regular `git pull`, because the remote `main` history may have been rewritten.

Preferred update flow for local `main`:

```bash
git checkout main
git fetch origin
git reset --hard origin/main
```

If local `main` contains unpublished commits, preserve them on another branch before resetting.

Agent rules:

- Treat `main` as a read-only sync target unless the user explicitly asks to work on it.
- Prefer working on `dev` or another non-`main` branch.
- Before editing code, confirm the current branch is appropriate for the task.
- If the branch is `main` and the task is normal feature work, stop and warn the user before proceeding.
- Do not resolve divergent `main` history with a merge commit.
- If `main` diverges from `origin/main`, prefer `fetch` plus explicit reset or user confirmation, not `pull`.
