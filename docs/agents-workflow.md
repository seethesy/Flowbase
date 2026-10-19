# Flowbase Agent Workflow

Single source of truth for Claude Code and Codex when implementing Jira tickets and when creating or updating Jira items. Follow it exactly. Only a direct instruction from the developer in the current session overrides it.

## 1. Reference

| Item | Value |
|---|---|
| Repo | `github.com/seethesy/Flowbase`, default branch `main` |
| Jira site | `sybertechlabs.atlassian.net` (cloudId `2e465ee7-f0e8-493c-8e68-9e7a7649088b`) |
| Jira project | `FLOW` |
| Developer's Jira accountId | `712020:7101d867-639d-4ae5-a53d-d1e08e4bd946` |
| Statuses | To Do, In Progress, Done |
| Issue types | Epic, Story, Task, Bug (never Subtask) |
| Labels | `needs-decision` only |

| Agent | Worktree | Base branch | Ticket branch prefix |
|---|---|---|---|
| Claude Code | `Flowbase-Claude` | `Flowbase-Claude` | `claude/` |
| Codex | `Flowbase-Codex` | `Flowbase-Codex` | `codex/` |

Worktrees sit beside the main checkout in `C:\Coding-Projects\Flowbase-Repo\`. Claude and Codex may run at the same time. Work only in your own worktree and branches. Never touch the other agent's worktree or branches, or the main checkout (`Flowbase`).

## 2. Definitions

- **Done** = the ticket's PR has merged into `main`. A blocker in Done is satisfied: its code is in `main`.
- **Automation** (GitHub–Jira) performs every status transition: to In Progress when linked development starts, to Done when the PR merges into `main`. If a status looks wrong, report it to the developer. Do not fix it.
- **Issue key linking**: automation matches work to tickets by key, so every branch name, PR title, and commit message contains the key (`FLOW-123`).
- **CI** (`.github/workflows/ci.yml`) is the only test authority. It runs lint, typecheck, Vitest, build, and Playwright on every PR.
- **Developer-only actions**: merging PRs (squash merge), closing rejected PRs, deciding what happens to their tickets.

## 3. Hard rules

Never:
- change a Jira status, or create labels, statuses, or issue types;
- merge a PR, or commit to `main` or your base branch;
- run tests or checks locally: no `npm run lint|typecheck|test|test:e2e|build`, no `npx vitest|playwright|tsc|eslint`;
- run `git reset --hard`, `git clean`, `git stash`, `git checkout -- <path>`, `git rebase`, or `git push --force*` (only exception: §5.3);
- discard, overwrite, or commit changes you did not make;
- invent product decisions, file paths, APIs, or issue keys;
- explore the repo beyond what the current task needs.

When blocked, stop and tell the developer the exact obstacle and what you need. Do not guess.

## 4. Implementing a ticket

Start only when the developer prompts you with a ticket key (or several keys, see §5).

### 4.1 Read
1. Fetch the ticket with description, comments, labels, status, and issue links. Read every AC, Q, and A.
2. **Blockers:** every `is blocked by` ticket must be Done, unless it is in the same batch (§5.1). Otherwise stop and report which blocker is not Done.
3. **Questions:** if any Q has no A:
   - Ask the developer each unanswered Q in chat, by number.
   - Meanwhile, implement only work the Q does not affect.
   - When the developer answers in chat, add it to the ticket description under the Q as `A#: <answer>`. When every Q has an A, remove `needs-decision`.
   - Never re-ask an answered Q.

### 4.2 Resume or start
1. Check for existing work:
   ```sh
   git branch -a --list "*FLOW-123*"
   gh pr list --state all --search "FLOW-123"
   ```
   - Open PR or existing branch: switch to it, continue from §4.3.
   - Closed, unmerged PR: stop and ask the developer.
2. Otherwise create the ticket branch:
   ```sh
   git status --porcelain            # must print nothing; otherwise stop and report
   git fetch origin
   git switch <base-branch>
   git merge --ff-only origin/main   # on failure: stop and report; never reset or rebase
   git switch -c <prefix>FLOW-123-short-slug
   ```
   Slug: 2–5 lowercase words, hyphenated.
3. One ticket or batch at a time per worktree. Create extra worktrees only when the developer asks.

### 4.3 Implement
- Deliver the ticket's ACs and requirements. Nothing else: no unrelated refactors, renames, or reformatting.
- Follow the existing patterns in the files you touch (README → Architecture).
- Make routine technical decisions yourself. Ask only about product decisions (behavior, scope, security, cost, architecture).
- Add a dependency only when the ticket requires it, with `npm install <pkg>` (the only npm command you may run), and justify it in the PR.
- Write or update tests for every delivered AC and for edge cases and regressions the change risks: Vitest in `tests/`, Playwright in `tests/e2e/`. Write them; do not run them.
- Commit message: `FLOW-123: <imperative summary>`. Stage only files you changed for this ticket.

### 4.4 Before the PR
1. Mark each AC delivered or not delivered. Unfinished or untested work is not delivered.
2. If any AC is not delivered, complete §6 first.
3. List manual checks the developer must do for anything automated tests cannot cover.

### 4.5 Open the PR
Push once, when all commits are ready. Every push to an open PR re-runs CI.
```sh
git push -u origin <branch>
gh pr create --base main --title "FLOW-123: <summary>" --body-file <file>
```
Body (omit empty sections; never open a draft PR):
```markdown
Jira: [FLOW-123](https://sybertechlabs.atlassian.net/browse/FLOW-123)

## Summary
- <what changed and why>

## Acceptance criteria
- [x] AC1 <short text>
- [ ] AC3 <short text> → FLOW-130

## Tests
- <test file>: <what it covers>

## Manual checks
- <steps for the developer>

## Follow-ups
- FLOW-130
```

### 4.6 CI and hand-off
1. `gh pr checks <pr> --watch`
2. On failure: `gh run view <run-id> --log-failed`, fix, commit, push once. After 3 failed fix attempts, stop and report.
3. Report to the developer: PR link, CI result, follow-up tickets, manual checks. Then stop.

### 4.7 After hand-off
- Changes requested: same branch, same PR, then §4.6.
- Merged: nothing to do; automation moves the ticket to Done.
- Closed without merging: do nothing unless the developer instructs.

## 5. Multiple tickets

Pick the strategy before starting and state it to the developer in one line.

### 5.1 Batch PR (default for related or dependent tickets)
Use when tickets touch the same files or systems, or one depends on another, and the combined change reviews as one unit. Never batch unrelated tickets to reduce PR count.
- Branch: lowest key, e.g. `claude/FLOW-12-short-slug`.
- PR title: every key, e.g. `FLOW-12, FLOW-13: <summary>`. Body: one AC checklist per ticket.
- Commits: the key(s) each commit serves.
- Apply §4.4 to every ticket in the batch.

### 5.2 Separate PRs (independent tickets)
One after another, each through §4 from a freshly synced base.

### 5.3 Stacked PRs (only when the developer asks)
- First branch from the synced base; each next branch from its predecessor. Each PR's base is its predecessor's branch and contains only its own ticket.
- After a lower PR merges, retarget the next one to `main` so it merges into `main`:
  ```sh
  git fetch origin
  git rebase --onto origin/main <merged-branch> <next-branch>
  git push --force-with-lease
  gh pr edit <next-pr> --base main
  ```
  This is the only permitted rebase and force-push, and only on your own unmerged ticket branches.
- Never stack on the other agent's branches.

## 6. Partial delivery

Allowed. Before opening the PR:
1. Create one follow-up ticket holding all undelivered ACs (several only if they are separate deliverables per §7.2). Use the §7.3 template, the original's issue type and Epic, summary `<summary> (follow-up to FLOW-123)`, and a `Relates` link to FLOW-123. Copy the context it needs; do not just point back.
2. In FLOW-123's description, append ` → moved to FLOW-130` to each moved AC. Never delete or reword the original AC.
3. For each ticket FLOW-123 blocks that needs moved functionality, add `FLOW-130 blocks <ticket>`. Keep the existing FLOW-123 link.
4. List the follow-ups in the PR (§4.5).

## 7. Creating and updating Jira items

### 7.1 Research first
- Search for duplicates and overlap (`project = FLOW AND text ~ "<keyword>"`). Update an existing ticket instead of creating a near-duplicate.
- Read the relevant code, tests, and docs. Verify every file, component, and API you cite exists.
- Turn unverified assumptions into Qs or label them as assumptions.

### 7.2 Scope and fields
- One ticket = one coherent, independently verifiable deliverable that fits one PR. Split only when parts differ in dependencies, outcome, or verification.
- Type: Story = user-visible behavior; Task = technical or internal work; Bug = defect in existing behavior; Epic = feature area, set as the ticket's parent.
- Priority: set only when the developer gives one.
- New tickets: To Do, unassigned.
- Developer-only work (e.g. account setup, secrets, external configuration): a separate ticket assigned to the developer, with numbered steps and a completion check. Questions stay on the implementation ticket.

### 7.3 Description template
Use these headings in this order; omit empty ones.
```markdown
## Objective
What and why, 1–3 sentences.

## Requirements
Required behavior, constraints, explicit exclusions.

## Acceptance Criteria
- AC1: <objective, testable outcome>
- AC2: <edge case or regression outcome>

## Technical Context
Verified files, patterns, constraints. Reference code; do not paste it.

## Developer Questions
**Q1:** <question>. Context: <why it matters>. Options: A) … B) …. Recommendation: <option + reason>.

## Verification
Tests to add (Vitest, Playwright) and manual checks. Do not restate the CI pipeline.

## Dependencies
What this ticket needs from each blocker, only when the link alone does not make it clear.
```
- State what must be achieved; prescribe how only when technically required.
- No pseudocode, speculation, or rules already in this document.
- Use the project's existing terms (README, UI labels, type names).

### 7.4 Developer questions
- Ask only about decisions that materially change behavior, scope, security, cost, or architecture and are not already settled in code, docs, Jira, or prior answers. Routine implementation choices belong to the implementing agent.
- Number them Q1, Q2, … The developer answers as `A1:` under each Q.
- Add `needs-decision` while any Q is unanswered; remove it when all are answered.
- Questions are never blockers: they change no status and no links.
- Create a separate decision ticket only when one decision affects several tickets.

### 7.5 Dependencies
- `X blocks Y` means Y cannot be implemented until X is in `main`. Link only direct prerequisites; no transitive or circular links.
- Use `Relates` for related, non-blocking tickets.
- Never remove a link because its blocker is Done. Remove it only when the dependency is no longer needed.
- When you create, split, or rescope a ticket, re-check the links of every ticket it touches. On splits, apply §6 step 3.
