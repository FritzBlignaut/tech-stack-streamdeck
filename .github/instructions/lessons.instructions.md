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
