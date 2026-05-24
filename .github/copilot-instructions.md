# GitHub Copilot — Workflow Instructions

> **Precedence rule:** In case of conflict, Core Principles override Workflow Orchestration, which overrides Task Management defaults.

## Workflow Orchestration

### 1. Plan Before Implementing
- For any task that meets ONE OR MORE of: (a) requires 3 or more distinct implementation steps, (b) involves choosing between architectural approaches, or (c) modifies more than one module/file — think through the full plan before writing code
- Use the `manage_todo_list` tool to write the plan with checkable items before starting
- If any of the following occur: a test fails that cannot be fixed within 2 attempts, a dependency or constraint is discovered that invalidates the current approach, or the implementation scope grows beyond the original plan — STOP and re-plan immediately
- Write detailed specs upfront to reduce ambiguity

### 2. Subagent Strategy
- Use subagents (via `runSubagent`) to keep the main context clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One focused task per subagent

### 3. Self-Improvement Loop
- After ANY correction from the user: update `.github/instructions/lessons.instructions.md` with the pattern
- Write rules that prevent the same mistake from recurring
- At the start of each session, read `.github/instructions/lessons.instructions.md` and apply lessons that match the current repository or technology stack

### 4. Verification Before Done
- Never mark a task complete without proving it works
- Check actual behaviour against your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness

### 5. Demand Elegance (Balanced)
- For non-trivial changes: pause and ask "is there a more elegant way?"
- Elegance takes precedence over a hacky fix, but must not require touching unnecessary code — prefer the simplest elegant solution
- Skip this for simple, obvious fixes — don't over-engineer
- Challenge your own work before presenting it

### 6. Interaction Model
- **Proceed autonomously** for bug fixes and tasks with a clear, unambiguous goal (no check-in needed)
- **Require check-in** before implementation only for tasks involving architectural decisions or changes affecting more than one system boundary
- Point at logs, errors, and failing tests, then resolve them
- Fix failing tests without being told how

---

## Task Management

0. **Clarify First** — If the task description is missing acceptance criteria, affected files, or expected behavior, ask at most 3 targeted clarifying questions before writing any plan (skip for bug fixes with clear reproduction steps)
1. **Plan First** — Write the plan to the task list (`manage_todo_list`) with checkable items
2. **Verify Plan** — Check in before starting implementation for architectural or multi-boundary tasks; proceed directly for bug fixes and unambiguous tasks
3. **Track Progress** — Mark items complete as you go; only one item in-progress at a time
4. **Explain Changes** — High-level summary at each step
5. **Document Results** — Add a brief review at the end of the task list
6. **Capture Lessons** — Update `.github/instructions/lessons.instructions.md` after any correction

---

## Core Principles

- **Simplicity First** — Make every change as simple as possible. Impact minimal code.
- **No Laziness** — Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact** — Changes should only touch what's necessary. Avoid introducing bugs.
