# VS Code Agents Instructions

This file provides instructions for AI coding agents working with the VS Code codebase.

For detailed project overview, architecture, coding guidelines, and validation steps, see the [Copilot Instructions](.github/copilot-instructions.md).

## Repository Branch Workflow

This repository uses a single long-lived branch for normal work.

- `main` is the only long-lived working branch.
- Day-to-day development happens directly on `main`.
- Do not keep long-lived `dev`, `feature/*`, or `sync-main` branches as part of the default workflow.
- `origin/main` is the private source of truth for this repository.
- `upstream/main` is the baseline used when we need to bring in new VS Code changes.

Use this branch model instead:

- Start work from the latest `main`.
- Commit directly on `main`.
- When upstream changes are needed, fetch `upstream` and rebase `main` onto `upstream/main`.
- After an upstream rebase, push `main` with `--force-with-lease`.
- Only create an extra branch when the user explicitly asks for it or a risky experiment truly cannot be done safely on `main`.

Preferred start-of-work flow:

```bash
git checkout main
git fetch origin
git pull --ff-only origin main
```

Preferred upstream sync flow:

```bash
git checkout main
git fetch upstream
git rebase upstream/main
git push --force-with-lease origin main
```

Agent rules:

- Treat `main` as the normal working branch.
- Before editing code, confirm local `main` is in a sane state.
- If the task involves upstream sync, do it on `main` instead of recreating a separate mirror branch.
- Do not recreate `dev` or `sync-main` unless the user explicitly asks for a different workflow.
- When rewriting `main` after an upstream rebase, prefer `--force-with-lease` over `--force`.
