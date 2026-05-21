# GitHub Copilot — Workflow Instructions

## Workflow Orchestration

### 1. Plan Before Implementing
- For ANY non-trivial task (3+ steps or architectural decisions), think through the full plan before writing code
- Use the `manage_todo_list` tool to write the plan with checkable items before starting
- If something goes sideways during implementation, STOP and re-plan immediately
- Write detailed specs upfront to reduce ambiguity

### 2. Subagent Strategy
- Use subagents (via `runSubagent`) to keep the main context clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One focused task per subagent

### 3. Self-Improvement Loop
- After ANY correction from the user: update `.github/instructions/lessons.instructions.md` with the pattern
- Write rules that prevent the same mistake from recurring
- Review lessons at the start of a session for the relevant project

### 4. Verification Before Done
- Never mark a task complete without proving it works
- Check actual behaviour against your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness

### 5. Demand Elegance (Balanced)
- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky, implement the elegant solution instead
- Skip this for simple, obvious fixes — don't over-engineer
- Challenge your own work before presenting it

### 6. Autonomous Bug Fixing
- When given a bug report: just fix it — no hand-holding needed
- Point at logs, errors, and failing tests, then resolve them
- Zero context switching required from the user
- Fix failing tests without being told how

---

## Task Management

1. **Plan First** — Write the plan to the task list (`manage_todo_list`) with checkable items
2. **Verify Plan** — Check in before starting implementation
3. **Track Progress** — Mark items complete as you go; only one item in-progress at a time
4. **Explain Changes** — High-level summary at each step
5. **Document Results** — Add a brief review at the end of the task list
6. **Capture Lessons** — Update `.github/instructions/lessons.instructions.md` after any correction

---

## Core Principles

- **Simplicity First** — Make every change as simple as possible. Impact minimal code.
- **No Laziness** — Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact** — Changes should only touch what's necessary. Avoid introducing bugs.
