---
name: solid-kiss-dry-refactor
description: "Refactor code using SOLID, KISS, and DRY principles. Use when: improving code quality, reducing duplication, simplifying complex logic, splitting responsibilities, fixing over-engineering, extracting reusable abstractions, reviewing a file or module for design smells."
argument-hint: "File or module to refactor, or describe the code smell to fix"
---

# SOLID, KISS & DRY Refactor

## When to Use
- A function or class has more than one reason to change (SRP violation)
- Logic is duplicated across two or more places (DRY violation)
- A function is hard to read or does too much at once (KISS violation)
- A class is modified every time a new variant is added (OCP violation)
- A caller depends on low-level details instead of an abstraction (DIP violation)
- Interfaces force implementors to define methods they don't use (ISP violation)

---

## Principles Reference

### SOLID
| Letter | Principle | Violation Signal |
|--------|-----------|-----------------|
| **S** | Single Responsibility — one reason to change | Class/function does fetching + parsing + rendering |
| **O** | Open/Closed — extend without modifying | Adding a new type requires editing a `switch` / `if-else` chain |
| **L** | Liskov Substitution — subtypes behave like base types | Override throws, ignores, or weakens a base-class contract |
| **I** | Interface Segregation — no forced unused methods | Interface has 10 methods but most implementors use 2 |
| **D** | Dependency Inversion — depend on abstractions | High-level module `new`s a concrete low-level class inline |

### KISS
- Prefer the simplest solution that satisfies the requirements
- Avoid unnecessary layers of indirection, abstraction, or configuration
- Code should be readable by a new contributor without explanation

### DRY
- Every piece of knowledge has one authoritative representation
- Identical logic in two places → extract to a shared function/module
- Identical structure in two places → consider a generic abstraction *only if* the duplication is genuine knowledge duplication, not coincidental similarity

---

## Procedure

### Step 1 — Analyze
1. Read the target file(s) in full.
2. List every violation found, tagged by principle (e.g. `[SRP]`, `[DRY]`, `[KISS]`).
3. Rate each violation: **High** (blocks extension / causes bugs), **Medium** (maintenance burden), **Low** (style preference).

### Step 2 — Prioritise & Plan
1. Sort violations: High → Medium → Low.
2. For each High/Medium violation, describe the refactoring move (e.g. *extract function*, *introduce interface*, *inline variable*, *replace conditional with polymorphism*).
3. If changes affect more than one module or require a new abstraction, **present the plan to the user and get approval before writing code**.

### Step 3 — Refactor (one violation at a time)
Apply refactors incrementally:
- **Extract function/method** — for KISS/SRP violations in functions > ~20 lines or doing > 1 thing.
- **Extract module/class** — for SRP violations at the class level.
- **Introduce abstraction / interface** — for OCP and DIP violations.
- **Deduplicate** — for DRY violations; create a shared utility/helper, then update all call sites.
- **Simplify** — for KISS violations; remove dead code, flatten nested logic, replace clever tricks with readable code.

After each individual refactor:
- Confirm the code still compiles / has no type errors.
- Do not change behaviour — refactoring is behaviour-preserving.

### Step 4 — Verify
1. Run the project's test suite (`npx vitest run` for this repo, or the relevant test command).
2. All tests must pass before marking done.
3. If tests break, fix them — the refactor changed a public API that tests depended on.

### Step 5 — Summarise
Report:
- What violations were found
- What was changed and why
- Any trade-offs made (e.g. skipped a Low violation to avoid over-engineering)
- Whether tests pass

---

## Decision Guardrails

| Situation | Do |
|-----------|----|
| Two functions look similar but represent *different* concepts | Leave them separate (coincidental duplication) |
| Abstraction would only be used once | Don't introduce it (YAGNI / KISS) |
| Fixing an ISP/DIP violation requires a large interface redesign | Propose it, don't do it unilaterally |
| A violation is minor and touching it risks a regression | Note it, leave it, don't fix it |

---

## Anti-Patterns to Avoid
- **Over-abstracting**: Adding factories, registries, or strategy patterns where a simple function suffices
- **Premature deduplication**: Merging two functions that happen to look the same but will diverge
- **Renaming without substance**: Improving names without fixing the structural issue
- **Splitting for splitting's sake**: Breaking a cohesive 30-line function into 5 micro-functions with no clarity gain
