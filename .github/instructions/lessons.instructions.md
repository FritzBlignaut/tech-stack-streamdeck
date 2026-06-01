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
  --repo tech-stack-studios/tech-stack-streamdeck \
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

## 2026-05-25 — NEVER commit or make changes directly on `develop` or `main`

**Mistake:** Made app feature changes (collapsed menus, button drag-and-drop) directly on the `develop` branch instead of creating a feature branch first.

**Rule:** `develop` and `main` are protected branches. ALL code changes — no matter how small — must be made on a `feature/<name>` or `bug/<name>` branch created from `develop`. Direct commits to `develop` or `main` are strictly forbidden.

**Mandatory pre-work checklist before writing any code:**
1. Run `git branch --show-current` — if the answer is `develop` or `main`, STOP.
2. Use the **Branch Manager** agent to create an appropriately named branch.
3. Switch to that branch, then begin implementation.

**This applies to ALL changes including:** config files, CI workflows, documentation, hotfixes, and one-liners.

## 2026-05-25 — GitHub Copilot instructions and agents are mandatory

**Rule:** The workflow in `.github/copilot-instructions.md` and the lessons in this file are non-negotiable. They MUST be followed on every task, every time.

**Agents must be used where applicable:**
- **Branch Manager** — invoke before starting ANY implementation work to create the correct branch.
- **GitHub Manager** — use for all GitHub operations (issues, PRs, labels, CI monitoring, GitHub Releases). Never use GitKraken or third-party tools.
- **Release Manager** — use when cutting any release (alpha, beta, or official). Handles the full pipeline: PR promotion, CI wait, artifact download, and GitHub Release publishing.
- **Explore** — use for codebase research to keep the main context clean.

**Never skip an agent** because the task "seems simple." Predictability and consistency are the goal.

## 2026-05-27 — Run git branch --show-current before EVERY edit, not just at session start

**Mistake:** Did not run `git branch --show-current` before making file edits mid-conversation. The user had switched to `develop` between requests (likely after merging a PR). The commit landed directly on `develop` — a direct violation of the branch rule.

**Rule:** `git branch --show-current` MUST be run as the very first thing in every response, **before any file read, edit, or plan**. Not just at session start. Not just for "new tasks". Every. Single. Response. If the result is `develop` or `main`, stop immediately and invoke Branch Manager before touching anything.

**The pre-flight is not a session-start ritual — it is per-response and unconditional.**

**Mistake:** Trusted the Branch Manager agent's return message ("Branch created: feature/discord-plugin") as proof that the terminal was on that branch. Did not run `git branch --show-current` before making changes. Also did not read `lessons.instructions.md` at the start of the response. Changes landed on the correct branch by luck, but the process was broken.

**Rule:** The pre-flight block in `copilot-instructions.md` executes for EVERY prompt, including trivial ones. It is not a "session start" thing — it fires at the top of every single response before any planning or code. Steps are non-negotiable:

1. `read_file` → `.github/instructions/lessons.instructions.md` (full file, every prompt)
2. Run `git branch --show-current` in the terminal, print the result
3. If on `develop` or `main` and task may touch files → Branch Manager immediately, then verify branch AGAIN with `git branch --show-current`
4. **Never trust an agent's success message as proof of branch switch** — always verify with the terminal command

**Enforcement:** The user must NEVER have to remind GitHub Copilot to follow this workflow. It is automatic, silent, and unconditional.
