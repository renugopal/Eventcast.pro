# EventCast.pro Agent Operating Rules

## Scope and authority

This file applies to the entire repository. A more deeply nested `AGENTS.md`
adds rules for its subtree but cannot weaken the repository-wide architecture,
security, evidence, or approval rules here.

Before material work, read in this order:

1. `AGENTS.md`
2. `PROJECT_CONTEXT.md`
3. `CURRENT_STATE.md`
4. The authoritative documents linked by `PROJECT_CONTEXT.md` for the area
   being changed
5. Any nested `AGENTS.md` in the target subtree
6. `MATERIAL_WORK_LOG.md` for recent continuity notes

`docs/_legacy/`, `MASTER_PLAN.md`, `TASK_LOG.md`, `PROJECT_DIARY*.md`, scratch
files, old handoffs, chat summaries, and agent-specific local rules are
historical or supporting evidence only unless a current authoritative document
explicitly adopts them. Conversation memory may help locate evidence, but it is
never proof of repository, deployment, database, migration, or remote-system
state.

## Locked architecture and security boundaries

- New streaming architecture is **SRS plus the Go EventCast Media Agent only**.
  New design, provisioning, deployment, or fallback mechanisms must not
  introduce, restore, or select Restreamer, and Restreamer must not be used as
  a fallback. Existing production routing is unverified unless directly
  checked through authorized external access; do not change it or retire legacy
  components without that read-only verification, explicit deployment
  authorization, and the reviewed cutover sequence.
- Cloudflare **R2** is for hot, live, temporary, and processing media.
  **Backblaze B2** is the authoritative store for finalized Event Recordings.
- **Wasabi is excluded** from the authoritative architecture. Existing Wasabi
  references are legacy reconciliation evidence, not permission for new use.
- Never expose to browser/client code or client-visible responses: media-node
  credentials, raw publish tokens, YouTube keys, service-role credentials,
  credential digests, replay nonces, internal URLs, direct database
  connections, or internal query capability.
- Keep the control plane out of the synchronous media packet path. Preserve
  secret redaction, least privilege, idempotency, durable queueing, and
  fail-closed authorization behavior.
- Do not silently change a locked decision. Report the conflict and require an
  approved ADR or explicit owner decision before implementation.

The authoritative architecture map and precedence rules are in
`PROJECT_CONTEXT.md`.

## Mandatory read-only baseline

At the start of every material task, before editing:

1. Confirm the intended repository root and resolve every target path.
2. Read the applicable context and instruction files.
3. Run read-only Git checks for branch, `HEAD`, upstream relationship, staged
   state, and working-tree state. At minimum:

   ```text
   git branch --show-current
   git rev-parse HEAD
   git status --short --branch
   git diff --cached --name-status
   ```

4. Record whether observations come from local Git, repository content, or an
   external system. A local tracking ref such as `origin/main` is not proof of
   the current remote tip unless the remote was directly queried during the
   task.
5. If the worktree is dirty, identify the pre-existing modified and untracked
   scope before writing.

Read-only local or external Git queries may be run only when they are within
the current task's explicit scope. Do not fetch, pull, switch branches, create a
branch, stash, stage, commit, or otherwise mutate Git state merely to establish
the baseline.

## Worktree and path safety

- Treat every pre-existing dirty or untracked item as user-owned. Preserve it
  unless the task explicitly names it.
- Naming a path does not by itself authorize discarding its pre-existing work;
  preserve the existing intent or stop and report an unsafe overlap.
- Never discard, overwrite, clean, move, format, stage, or include unrelated
  work. Do not use broad cleanup or reset commands.
- Use explicit, quoted paths. Before a recursive delete, move, bulk rewrite, or
  generated-output replacement, resolve and verify that every target is inside
  the intended subtree.
- Avoid repository-wide mechanical edits when a focused change is sufficient.
- Inspect the exact diff for every authorized path before completion.
- If an existing change overlaps the requested edit and intent cannot be
  preserved safely, stop and report the overlap instead of guessing.

## Secrets and sensitive data

- Never commit, paste, echo, log, summarize, or return secret values.
- Do not open or enumerate `.env`, credential stores, deployment secrets,
  database connection strings, private keys, or token-bearing local files
  unless the task requires it and the user has authorized that access.
- Refer to secret locations or variable names only; use redacted placeholders
  in examples.
- Do not perform credential creation, retrieval, rotation, revocation, hashing,
  validation against live credentials, or secret-store mutation without
  explicit approval.
- Treat signed URLs, internal hostnames/URLs, raw ingest URLs, authorization
  headers, credential digests, and replay material as sensitive even when they
  are not sufficient by themselves to authenticate.

## Scope, implementation, and approval boundaries

Make the smallest change that satisfies the requested outcome. Preserve
existing behavior outside the named scope. Do not add dependencies, perform
framework upgrades, rewrite architecture to match code, or change generated
assets incidentally.

Explicit user approval is required before any of the following:

- any Git command that writes refs, the index, working tree, Git configuration,
  or object database, including add/stage, commit, push, fetch, pull, merge,
  rebase, cherry-pick, revert, restore, checkout, switch, reset, stash, clean,
  update-ref, tag, PR creation, and worktree or submodule mutations
- deployment, rollback, DNS/CDN/storage policy change, or production validation
  that changes external state
- applying, editing, or reverting a database migration
- SSH commands that mutate a host or any VM start/stop/delete operation
- package or tool installation and dependency-lock changes
- credential or secret operations
- destructive filesystem/database/storage actions
- any other remote-system mutation

Read-only local Git inspection is allowed only within the current task scope.
Read-only external Git queries require explicit current-task authorization for
external access and must not update local refs or objects.

Read-only inspection does not grant permission for a related mutation.

## Testing and validation

- Read the target package's scripts and local instructions before choosing
  commands.
- Run the smallest relevant existing tests, type checks, builds, or
  documentation validation proportional to the change. Do not install missing
  tools without approval.
- Include negative/security cases for auth, tenancy, secrets, state transitions,
  retries, deletion guards, and client-response allowlists when relevant.
- Do not weaken tests, suppress real failures, or claim production readiness
  from a narrow local check.
- For documentation-only work, validate links/paths, architecture terminology,
  source precedence, and the final Git diff. Product builds are not required
  unless the documentation change affects generated or executable content.

## Self-review and completion

Before reporting completion:

1. Re-read the request and the relevant locked decisions.
2. Validate every tracked authorized path with
   `git diff -- <exact authorized paths>`. Validate every untracked authorized
   path with exact-path
   `git status --porcelain=v1 --untracked-files=all`, complete file inspection,
   and comparison with the intended content. Ordinary `git diff` does not show
   untracked files; a zero unstaged diff is not validation of them.
3. Only after staging has been explicitly approved, use
   `git diff --cached -- <exact authorized paths>` as final staged-content
   evidence.
4. Re-run the read-only Git baseline and distinguish pre-existing changes from
   task changes.
5. Report files changed, checks run and results, unresolved conflicts, skipped
   checks, and all external actions (including that none occurred).
6. Do not state that a remote deployment, migration, branch, or service is
   current unless it was directly verified during this task.

## Authorization-safe durable continuity protocol

Continuity bookkeeping never expands the current task's authority. Edit
`CURRENT_STATE.md` or `MATERIAL_WORK_LOG.md` only when the current user request
explicitly authorizes writing that exact path. Authorization to edit does not
authorize staging or committing; each requires separate explicit approval.

- When the current request explicitly authorizes `CURRENT_STATE.md`, refresh it
  with a dated, evidence-labelled snapshot only if a material recorded fact
  changed or fresh direct evidence materially disagrees with the snapshot.
  Keep unknown external state marked `unverified`; never roll forward a chat
  claim as fact.
- When the current request explicitly authorizes `MATERIAL_WORK_LOG.md`, append
  one concise entry for the underlying material task describing scope, files,
  validation, external actions, and unresolved follow-ups.
- In a read-only or no-write task, do not mutate either continuity file. Put the
  verification in the task report. If a refresh is warranted but its exact path
  is not authorized, report a pending continuity refresh instead.
- If no material state changed, do not churn either file; note the verification
  in the task report instead.
- Architecture changes require an ADR update or new reviewed ADR. A state or
  work-log entry cannot override an ADR.
- Keep `CURRENT_STATE.md` concise and replace stale snapshot values rather than
  accumulating contradictory "current" claims.

After an authorized material commit, use this non-recursive two-phase protocol:

1. Run a read-only Git baseline and report the actual final `HEAD` in the task
   report.
2. Refresh `CURRENT_STATE.md` only with explicit path-level write
   authorization. Record the evidence time and label a hash as the observed
   subject commit or as `HEAD` observed before a snapshot-bookkeeping commit;
   never claim that the snapshot contains its own commit hash.
3. Staging or committing that refresh requires separate explicit approval.
   Continuity-only bookkeeping is part of the original task and does not
   trigger another continuity refresh or a recursive material-log entry.

A material task includes product or infrastructure behavior changes, schema or
contract changes, deployments, migrations, security changes, architecture
decisions, dependency changes, operational incidents, and continuity-system
changes such as this file.
