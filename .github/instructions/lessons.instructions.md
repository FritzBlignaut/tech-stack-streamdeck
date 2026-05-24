---
applyTo: "**"
---
# Lessons Learned

> Automatically updated by GitHub Copilot after user corrections.
> Each entry captures a pattern to avoid repeating the same mistake.

---

<!-- Copilot: append new lessons below as `## YYYY-MM-DD — <short title>` blocks -->

## 2026-05-21 — Always follow copilot-instructions.md workflow without skipping steps

**Mistake:** Implemented a large multi-phase feature (OBS Studio integration) by jumping straight into code after reading a conversation summary. Skipped: reading `lessons.instructions.md` at session start, explicitly verifying the plan with the user before implementing, and running `npm run test:local` to prove correctness before marking tasks complete.

**Rule:** The workflow in `.github/copilot-instructions.md` is mandatory and non-negotiable unless the user explicitly says to skip a step. Every step must be followed in order, every time, for every non-trivial task:

1. Read `lessons.instructions.md` at the start of any session involving this repo.
2. Write the full plan to `manage_todo_list` **before writing any code**.
3. **Check in with the user** to verify the plan before starting implementation.
4. Mark items in-progress before starting, completed immediately after finishing — one at a time.
5. **Run `npm run test:local`** (or the relevant test/build command) after implementation and confirm it passes before marking the overall task done.
6. Capture any user corrections in this file immediately.

**The predictability contract:** The user relies on this workflow being executed identically every time so they can trust and expand on it. Deviating silently — even when the implementation seems straightforward — breaks that contract.

## 2026-05-21 — Always keep unit tests in sync with component API changes

**Mistake:** Refactored OBS action types from a generic `{ type: 'obs', operation: '...' }` to discrete types (`obs-record`, `obs-scene`, etc.) without updating the unit tests in `src/__tests__/components.test.jsx`. This caused 8 test failures in CI.

**Rule:** Whenever a component's rendered output, props, or action API changes, immediately update the corresponding tests **in the same change**. Never ship a feature without running `npx vitest run` and confirming all tests pass. If tests were written against an old API, rewrite them to match the current API — do not delete them without replacement.

**Checklist addition:** After every non-trivial code change, explicitly run `npx vitest run` as a step in the workflow — not just `npx vite build`.

## 2026-05-24 — Use GitHub CLI (`gh`) to create issues; never use GitKraken or third-party MCP tools for GitHub operations

**Mistake:** Attempted to create GitHub issues using the `mcp_gitkraken_issues_create` tool, which the user rejected as an unwanted third-party dependency.

**Rule:** For all GitHub operations (issues, PRs, labels, etc.) in this repo, use the GitHub CLI (`gh`) directly in the terminal. It is already authenticated (`gh auth status`) and avoids any third-party tool dependency. Never use GitKraken MCP tools for GitHub operations unless the user explicitly requests it.

**Issue creation template:**
```bash
gh issue create \
  --repo FritzBlignaut/tech-stack-streamdeck \
  --title "..." \
  --label "bug" \
  --body "..."
```

**Available labels:** `bug`, `documentation`, `duplicate`, `enhancement`, `good first issue`, `help wanted`, `invalid`, `question`, `wontfix`

## 2026-05-24 — Always create a branch from `develop` before working on any issue

**Rule:** Before writing a single line of code for any issue (bug or feature), create a dedicated branch from `develop` and switch to it. Never work directly on `develop` or `main`.

**Branch naming convention:** `bug/<short-description>` for bugs, `feature/<short-description>` for enhancements.

**Commands:**
```bash
git checkout develop
git pull
git checkout -b bug/<short-description>
```

This ensures work is isolated, traceable to the issue, and can be reviewed via a PR before merging.
