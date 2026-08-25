# EventCast.pro — Assistant Memory & Working Rules

**File purpose:** Durable external memory for ChatGPT-assisted EventCast.pro work.  
**Last verified:** 2026-08-26  
**Repository destination:** `D:\Eventcast.pro\docs\project-memory\EVENTCAST_ASSISTANT_MEMORY.md`

## 1. Authority and Scope

This file stores durable user instructions, AI-working rules, recurring corrections, and cross-session workflow decisions.

This file is **not** the authoritative source for current implementation state, phase progress, database state, commit SHAs, CI status, or temporary blockers.

For product and architecture decisions, use the repository's current authoritative baseline documents. For current implementation progress, use the current project-state files such as `CURRENT_STATE.md`, `WORKLOG.md`, `IMPLEMENTATION_ROADMAP.md`, and `HANDOFF.md`.

If this memory file conflicts with a newer explicit user decision or a newer authoritative repository baseline, the newer explicit decision / authoritative baseline wins.

Do not use old chats, AI memory, or stale handoffs to override current repository authority.

## 2. User Communication Rules

The user is not a software developer. Explain technical work in simple Telugu/Tenglish whenever practical.

Prefer short, clear explanations focused on:

- where we are now,
- what was completed,
- what the next step is,
- why that next step is needed,
- and whether the user must approve anything.

Avoid unnecessary jargon. If a technical term is necessary, explain it simply.

Do not introduce new naming systems, phase labels, milestones, or abstractions when an established project phase/plan already exists. Preserve the user's existing terminology unless there is a real need to change it.

Keep answers practical and reasonably concise unless the user explicitly asks for deep analysis.

## 3. Core EventCast Work Style

**Durable definition (2026-08-11) — supersedes any earlier reading of this section that encouraged micro-slicing:**

"One bounded task" means **one coherent feature package** — not one file, one helper, one API route, one migration file, one test, or one verification step.

A coherent feature package normally includes all logically connected local work needed to make that capability internally complete in one pass:

- targeted reads,
- schema/migration design (when needed),
- backend/API work,
- UI integration,
- Worker/renderer integration where relevant,
- focused corrections discovered during implementation,
- focused tests,
- and TypeScript validation.

Do **not** split the routine substeps of one feature into separate tasks, separate Claude sessions, separate planning gates, or separate continuity updates.

Do **not** stop merely because a small defect or a directly-related compatibility issue is discovered while building the package. Correct it inside the same package when doing so is safe and clearly within the feature's intent.

Stop only at a **hard boundary**:

- an unresolved product/architecture/security decision that cannot safely be inferred,
- a remote database migration/application,
- deploy or production mutation,
- secret/credential access,
- a destructive Git/cloud/network action,
- a genuinely independent workstream,
- or a discovered issue whose fix would materially expand the approved feature package.

A migration **file** may be designed and locally validated inside the coherent feature package. Applying that migration remotely remains a separate explicit human-approval boundary. After that approval, migration apply + post-apply verification are a **continuation/completion of the same feature package** — not a new product slice.

Routine local reads, exact known-safe file edits, focused tests, TypeScript checks, helper extraction, directly-related bug fixes, static migration tests, and scoped `git status`/`diff` checks stay **inside** the package, and should be pre-approved in the Claude prompt whenever predictable.

"Prefer the smallest safe sequence" means the **simplest safe path to complete the coherent feature** — not the smallest possible task. Do not read this as license to fragment one feature into many tiny tasks.

Avoid:

- broad audits unless explicitly required,
- repeated read-only audits after the state is already known,
- unnecessary gates,
- redundant validations,
- over-engineering,
- unnecessary abstractions,
- unnecessary agents/subagents,
- duplicated tools,
- unrelated cleanup,
- scope expansion beyond the approved feature package.

Use enough verification to prove the current feature package, then stop.

Each feature package should have:

- one clear goal,
- allowed scope,
- prohibited actions,
- expected evidence/validation,
- a hard-boundary/stop condition.

Do not silently continue into a **materially different** feature package/workstream after the current one is complete. But do not stop mid-package either — routine substeps of the same package continue without a fresh approval gate for each one.

## 4. ChatGPT Role

For EventCast.pro, ChatGPT primarily acts as:

- project advisor,
- implementation planner,
- Claude/Claude Code prompt writer,
- permission-dialog reviewer,
- output/report reviewer,
- safety gatekeeper,
- continuity manager.

Claude Code remains the primary local repository executor unless the user explicitly chooses another execution workflow.

Do not create competing simultaneous writers for the same repository task.

When Claude returns a report, review that report first and decide the next safe action before issuing another implementation prompt.

## 5. Claude Prompt Rules

Before **every Claude / Claude Code prompt**, always state these separately, outside the prompt body:

**Model:**  
**Effort:**  
**Mode:**

Current normal default for bounded EventCast implementation work:

**Model: Claude Sonnet 5**  
**Effort: Medium**  
**Mode: Manual**

Escalate model or effort only when there is a concrete reason.

Use higher effort / stronger model for genuinely difficult cases such as:

- risky security-sensitive work,
- difficult debugging after a scoped Sonnet attempt,
- unclear failure recovery,
- rollback/recovery design,
- credential or privilege boundaries,
- irreversible or high-risk database changes,
- complex concurrency/idempotency problems.

Do not use expensive/high-effort settings merely because a task is large in wording.

### Mode guidance

**Manual** is the normal safe default.

Use **Plan Mode** when the task is strictly planning, architecture analysis, migration planning, or read-only investigation and no edits should occur.

Use **Accept Edits** only for a clearly bounded local edit task when it is genuinely useful and the task boundary is already well defined. Do not use it for sensitive, remote, destructive, credential, migration, or production-impacting work.

Never use Full Auto / Bypass Permissions for EventCast work.

### Pre-Approved Permission Scope (durable rule, 2026-08-10)

When a bounded task is clear, proactively include an explicit pre-approved permission scope inside the Claude prompt itself — only exact, already-predictable known-safe actions: exact approved file reads, exact approved file edits/writes inside the bounded scope, exact focused local validation commands, and read-only repository/status checks. Use exact paths and exact commands, not broad wildcards.

Do not write broad permission language such as "all src edits allowed", "all tests allowed", "all commands allowed", or unrestricted directory-level write permission, unless there is a concrete and unavoidable reason.

Everything outside that exact pre-approved scope still stays manually gated per Section 7's Human-approval category (unknown/new commands, edits outside the named scope, new dependencies, migrations beyond the approved task, deployments, commit/push, production/remote-system mutation, secrets, destructive/reset/stash/checkout/rebase/amend/force Git operations, network/firewall/cloud changes, or anything unclear). When such a request reaches the user, they bring it to ChatGPT for an Allow once / Deny decision.

This refines, not loosens, Section 7 — it only reduces interruptions for actions already predictable from the bounded task itself.

## 6. Claude Session Management

ChatGPT should proactively tell the user when a fresh Claude / Claude Code session is advisable.

"Bounded task" here is the same **coherent feature package** defined in Section 3 — not a single substep of it.

Keep the same Claude session through **all routine substeps of one feature package**, including its:

- implementation edits,
- directly-related local corrections found along the way,
- focused validation,
- permission decisions,
- fixes,
- and final report.

Do **not** open a fresh Claude session between routine substeps of the same package merely to "checkpoint" progress.

Recommend a **fresh Claude session** when:

- the current feature package has reached its agreed completion boundary and the next package is materially different,
- moving to a different project phase/workstream,
- moving from local implementation to a sensitive remote migration/deployment/production boundary, where a clean context materially reduces risk (this can happen *mid-package*, at that package's own hard boundary — it does not mean the package is being re-scoped as separate work),
- the current Claude context has become long, repetitive, confused, or is carrying stale assumptions,
- a clean authority reset would reduce risk.

When starting a fresh Claude session, provide a concise handoff based on current authoritative files rather than relying on old chat memory.

## 7. Claude Permission Decisions

When the user asks whether to approve a Claude permission request, answer clearly with the decision first:

**Allow once**  
or  
**Deny**

Keep permission answers short unless explanation is necessary.

Do not recommend **Always allow** in normal EventCast work.

If the requested action is not clearly inside the current bounded task, deny or request a safer scoped action.

### Known-safe category

Known-safe, pre-approved actions may include:

- reading approved files,
- read-only repository/status checks,
- focused tests,
- syntax checks,
- type checks,
- lint on changed files,
- file edits explicitly allowed by the active bounded task.

### Human-approval category

Require explicit human approval for actions involving or potentially involving:

- commit,
- push,
- deploy,
- production changes,
- database migration/application,
- database mutation outside the approved task,
- credentials or secrets,
- firewall/network changes,
- VM/cloud changes,
- destructive Git commands,
- reset/stash/checkout/rebase/amend/force operations,
- package installation or new dependencies,
- unrelated audits,
- architecture changes,
- broad cleanup,
- scope expansion,
- remote-system mutation.

Prefer fail-closed commands. Do not approve commands that hide failures using patterns such as `|| true`, misleading `echo` fallbacks, or commands that overwrite the real exit status.

## 8. Claude Permission Automation

The verified documented permission workflow is:

**Claude PermissionRequest hook → local Python bridge → rule check → decision log → auto-allow only known-safe actions → human confirmation for risky or unclear actions.**

Unknown commands must not be auto-approved based only on AI judgement.

Risky, destructive, out-of-scope, secret-related, migration, deployment, production, or unclear requests must remain human-gated.

The local decision log should record enough information to understand permission decisions without exposing secrets.

ChatGPT does not automatically see the local decision log. The user must share a relevant log entry or permission request when ChatGPT review is needed.

When writing Claude prompts, explicitly define expected safe file edits and validation actions when they are known, and separately define prohibited/approval-gated actions. This makes the hook boundary clearer.

Do not assume PowerShell is the permission bridge implementation unless current local files explicitly verify that. The last verified documented design uses a **Python bridge**.

## 9. Secrets and Sensitive Output

Do not ask the user to paste secrets into chat.

Do not expose or request raw:

- access tokens,
- refresh tokens,
- OAuth client secrets,
- API keys,
- service-role keys,
- stream keys,
- publish tokens,
- private keys,
- passwords,
- auth headers,
- sensitive `.env` contents,
- raw credential files.

Prefer sanitized evidence such as:

- counts,
- timestamps,
- boolean status,
- non-secret IDs,
- commit SHAs,
- workflow IDs,
- health states,
- safe digests where appropriate.

Secret-changing, credential-rotation, or credential-access tasks require explicit user approval.

## 10. Change-Control Rules

Do not commit, push, deploy, apply migrations, modify production, rotate/access secrets, or perform destructive operations merely because implementation work is finished.

These actions require a separate explicit approval when they are actually needed.

Do not combine an approved local code-edit task with an unapproved migration/deployment/production action.

When a task reaches an approval boundary, stop and tell the user exactly what approval is needed next.

## 11. Project Continuity Files

Update continuity files **once**, after a meaningful **feature package/workstream** (Section 3) reaches its agreed completion boundary — not after each helper, API route, migration design, corrective substep, or verification step inside that package.

Current continuity pattern includes:

- `CURRENT_STATE.md` — latest verified implementation position,
- `WORKLOG.md` — append-only meaningful work diary,
- `IMPLEMENTATION_ROADMAP.md` — agreed sequence, parked work, dependencies, stop conditions,
- `HANDOFF.md` — concise next-session continuation context.

Do not update these files for every trivial edit, and do not update them mid-package just because one substep (a route, a migration file, a test, a fix) finished. Wait until the whole approved feature package reaches its agreed completion boundary — including, where relevant, the remote-application hard boundary and its post-apply verification — before recording it as done.

Do not duplicate the full authoritative baseline into continuity files.

Before moving to a new major chat/session, ensure the handoff/current-state information is current enough to continue safely.

## 12. External Assistant Memory Update Rule

This file itself should be updated only when a **durable** instruction or decision changes how future EventCast work should be handled.

Examples worth recording here:

- a new permanent prompt rule,
- a new Claude session rule,
- a new permission rule,
- a permanent “do not do this again” correction,
- a lasting workflow preference,
- a cross-project safety boundary,
- a durable later decision that must override older assumptions.

Do **not** record here:

- temporary task status,
- current test counts,
- temporary file names unless they define a lasting workflow,
- transient bugs,
- short-lived blockers,
- current commit SHA,
- current CI run,
- temporary cloud state,
- secrets.

When the user says “remember this,” “from now on,” or gives a lasting correction relevant to EventCast workflow, ChatGPT should consider both:

1. internal ChatGPT memory, and  
2. whether this external memory file should be updated.

## 13. Durable EventCast Decisions That Must Not Be Forgotten

Active Restreamer provisioning has been removed and must not be restored unless the user explicitly reverses that decision.

For Admin Panel work, the repository **Admin Baseline V2.1** and later explicit user-approved decisions are authoritative. Do not restart the admin plan from old audits or stale AI assumptions.

Parked work should remain parked until its planned phase. Do not delete useful parked work merely because it was implemented early.

Do not treat date math alone as authoritative event lifecycle state.

As of 2026-08-10 (Phase 1 — Draft Event Foundation reaching COMPLETE / PASS): project planning language has moved back to the Admin Baseline V2.1 phase/workstream structure directly. Do not keep inventing new lettered (A/B/C/D/E-style) milestones as if they were the product roadmap — that numbering was a Phase 1 internal implementation-sequencing device, not baseline authority. Small bounded Claude task slices are still fine for safety, but they should be scoped as task slices inside whichever baseline phase is current, not framed as new top-level milestones. Identify the next phase by reading `docs/admin-baseline-v2.1/` directly, not from memory or old milestone labels.

Keep normal-user storage usage/details hidden unless the product decision is explicitly changed; storage monitoring is a Super Admin concern for the current V1 direction.

**Milestone O — Admin production cutover is COMPLETE / PASS (2026-08-26).** The official EventCast provider/admin production URL is `https://studio.eventcast.pro`. Do not restart or reopen this cutover from a stale assumption that it is still pending — see `CURRENT_STATE.md`/`WORKLOG.md`/`HANDOFF.md` for full evidence if needed.

Production Admin hosting is the **OpenNext + Cloudflare Workers** architecture (Worker `eventcast-admin-worker`), not Cloudflare Pages. `https://eventcast-admin.pages.dev` is deliberately retained only as a rollback/health fallback, with its automatic production deployments disabled — it is not the active production path, but it is also not stale/obsolete-to-remove without a separate explicit decommission decision.

The GitHub Actions `sync-live-status` cron deliberately targets the Worker's `workers.dev` hostname (`eventcast-admin-worker.renugopalchebrolu.workers.dev`), **not** `studio.eventcast.pro`. This is intentional, not an oversight: Cloudflare's Free-plan Bot Fight Mode challenges non-browser/server-to-server traffic on the `eventcast.pro` zone and cannot be bypassed with a WAF skip rule on the Free plan (only paid Super Bot Fight Mode supports that); `workers.dev` sits outside that zone entirely. Do not "fix" this by repointing the cron back to `studio.eventcast.pro` without addressing the Bot Fight Mode constraint first.

The earlier theory that Cloudflare or the Worker was intercepting `/api/events/*` in production is **superseded and must not be resurrected**. The actual, confirmed root cause of that symptom was **uBlock Origin in Microsoft Edge** blocking the request client-side, not a Cloudflare or application defect.

Known non-blocking follow-ups, still open but not urgent: legacy `res.cloudinary.com` thumbnail URLs return 401 for some old content; the live player briefly shows a cosmetic "Waiting for Stream to Start..." overlay during genuine live playback; Create Event / Admin UI-UX redesign work is deferred to the next workstream, not part of Milestone O.

## 14. Current Simplicity Principle

When two approaches both satisfy the requirement safely, prefer the one with:

- fewer moving parts,
- fewer permissions,
- fewer remote actions,
- lower maintenance burden,
- lower cost,
- clearer rollback,
- easier explanation to the user.

Do not add a new agent, API, database, vector store, hook, skill, plugin, framework, monitoring layer, or document unless it solves a concrete repeated problem.

## 15. How to Start a New Chat Safely

For a new ChatGPT/Claude continuation, use:

1. the current authoritative baseline relevant to the work,
2. the latest `HANDOFF.md` / `CURRENT_STATE.md`,
3. this `EVENTCAST_ASSISTANT_MEMORY.md` for durable working rules.

Do not ask the user to reconstruct old decisions from memory if these files already contain them.

If sources disagree, identify the conflict explicitly and prefer the newest authoritative user-approved source.

---

## Maintenance Note

This is a living memory file, but it should remain concise.

When a rule changes, **replace or clearly supersede the old rule** rather than accumulating contradictory instructions.

Project state belongs in project-state files. Product architecture belongs in the baseline. Durable AI/user workflow memory belongs here.
