# Flowbase agent instructions

`docs/agents-workflow.md` is the single source of truth for implementing Jira tickets, creating or updating Jira items, branches, PRs, and testing. Read it in full before starting any of that work and follow it exactly. Do not add workflow rules to this file; change that document instead.

The workflow permits `npm run typecheck`, `npm run typecheck:worker`, `npx eslint <changed files>`, and `npx vitest run <changed or related unit/worker test files>` before pushing. Read and update the relevant `docs/features/<area>.md` feature notes.
