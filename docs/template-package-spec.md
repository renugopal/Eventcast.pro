# Template Package Spec

Templates render an event's public page. This spec defines how templates are
packaged and, critically, the **immutable release** rule. It defines format and
process only; it changes no template code.

## Immutability (locked decision)

A published template release is **immutable**: once a version is published, its
content is never mutated in place. Fixes and changes ship as a **new version**.
Rationale:

- Events already rendered against a version keep rendering identically forever.
- Rollback is selecting a prior version, not reverting edits.
- A version can be content-addressed, cached aggressively, and audited.

## Identity

- **Template id** — stable human-readable identifier (e.g. `wedding-template-01`,
  the current `DEFAULT_TEMPLATE_ID` in the event contract).
- **Version** — monotonic identifier for a release of that template id.
- **Release reference** — the `(template id, version)` pair an event pins to. An
  event stores its `templateId`; the mechanism for pinning a specific **version**
  is `TBD` and must be defined before Phase 3 completes (see
  [implementation-plan.md](implementation-plan.md)).

## Package contents (descriptive of current assets)

A template today consists of rendering assets such as an `index.html` entry and
its supporting scripts/styles (e.g. the `wedding-template-01` template directory
and its `script.js`). A packaged release should bundle:

- the render entry (HTML/template),
- static assets it depends on (scripts, styles, fonts, images),
- a manifest declaring the template id, version, and the contract fields it
  consumes.

The exact manifest schema is `TBD`; it must at minimum name the template id,
the version, and the event-contract fields the template reads (see
[event-contract.md](event-contract.md)).

## Publish workflow (target)

1. Build the template assets for a candidate version.
2. Produce an immutable, content-addressed release artifact.
3. Record `(template id, version, content hash)` in a release index.
4. Never overwrite an existing `(template id, version)`.

## Consumption

- The render worker resolves an event's pinned release reference and serves that
  exact artifact.
- Because releases are immutable, cache invalidation for a given version is never
  required.

## Non-goals / open items

- Visual/design changes to any template — out of scope here.
- The version-pinning storage mechanism on the event — **TBD**.
- The manifest schema — **TBD**.
- No capacity, quota, or size limits are asserted here (not invented).
