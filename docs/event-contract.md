# Event Contract

The event contract is the shared shape of an event as it moves between the admin
form, the `/api/events/generate` endpoint, and persistence. Its **canonical
target** is the `packages/event-contract` workspace package. Until that package
exists, the **source of truth (migration input)** is
`eventcast-admin/src/lib/eventContract.ts`, and this document describes that
input faithfully so the move can be behaviour-preserving.

> Scope note: this document records the contract **as it exists today**. It does
> not add, rename, or remove fields. Any change is a separate, reviewed step.

## Persistence quirks captured by the contract

- `events.invitation_video_url` is a **scalar Postgres `text`** column (confirmed
  via PostgREST OpenAPI introspection), not `text[]`. Multiple invitation-video
  URLs are stored **backward-compatibly** as one **newline-separated string** in
  that same column — never as an array — so existing single-URL rows keep
  working unchanged.
- `gallery_urls` is an **array** column, but legacy rows may hold a newline
  string; the helpers accept either form on read.

## Shared defaults

| Constant | Value | Purpose |
| --- | --- | --- |
| `DEFAULT_PRIVACY_STATUS` | `Public (Visible Everywhere)` | Applied to **brand-new** events only. |
| `DEFAULT_TEMPLATE_ID` | `wedding-template-01` | Default template for new events. |
| `LEGACY_ROW_PRIVACY_FALLBACK` | `Unlisted (Link Only)` | Used only when hydrating a legacy row whose `privacy_status` is null. Deliberately distinct from the new-event default so duplicating/editing never silently makes an event **more** visible than it already was. |

## Conversion helpers

- `parseNewlineList(value)` — parses a newline-separated string **or** an array
  into a trimmed, empty-filtered `string[]`.
- `invitationVideoUrlsToDbValue(value)` — list → the scalar newline-joined string
  (or `null` when empty) for the `invitation_video_url` column.
- `invitationVideoDbValueToFormString(value)` — scalar/legacy-array → newline
  string for display.
- `galleryUrlsToFormString(value)` — array/legacy-string → newline string for
  display.
- `galleryFormStringToArray(value)` — form newline string → the `string[]` the DB
  column expects.

## Slug computation (create-only)

`computeEventSlug({ groomName, brideName, celebrantName, eventType })` builds
`"{groom|celebrant|event}-{bride|family}-{type}"`, lower-cased with whitespace
collapsed to hyphens. Slugs are computed **only on create**; edit preserves the
verified DB slug and duplicate clears it so a new one is computed on submit.

## Core shapes

### `EventFormState`

The shape the create/edit flow keeps in component state. Fields (all present in
the migration input): `eventType`, `groomName`, `brideName`, `celebrantName`,
`customTopTitle`, `eventDate`, `eventTime`, `timerTargetTime`, `showTimer`,
`venueName`, `venueMapLink`, `invitationVideoUrls`, `thumbnailUrl`,
`privacyStatus`, `galleryUrls`, `vodLink`, `templateId`, `youtubePrivacy`,
`customInitials`, `hideLoaderPhoto`, `loaderPhotoUrl`, `notes`,
`youtube_broadcast_id`, `youtube_stream_key`, `youtube_url`, `slug`,
`photographerName`, `photographerPhone`, `photographerInsta`.

### `EventDbRow`

The persisted row shape used for hydration. Uses snake_case column names, with
`invitation_video_url` typed `string | string[] | null` and `gallery_urls` typed
`string[] | string | null` to tolerate legacy rows. Photographer identity is a
reference (`photographer_id`) resolved separately via `PhotographerRef`.

### Hydration — `dbRowToFormState(row, options)`

Two modes:

- **edit** — everything preserved, including the verified slug and YouTube/VOD
  identifiers.
- **duplicate** — `slug`, `vodLink`, `youtube_broadcast_id`,
  `youtube_stream_key`, and `youtube_url` are **cleared** (must not be copied
  onto a new event); `groomName`/`celebrantName` get a ` (Copy)` suffix.

`showTimer` defaults to `true` when null; `privacyStatus` falls back to
`LEGACY_ROW_PRIVACY_FALLBACK` when null; `templateId` falls back to the provided
default (or `DEFAULT_TEMPLATE_ID`).

### Payload — `formStateToGeneratePayload(formState, meta)`

Builds the exact body sent to `/api/events/generate`: spreads form state, sets
`isEditing`/`editingId`, folds any `youtubeDetails` over the corresponding
fields, and converts `galleryUrls` to `string[]`.

### Server normalization — `normalizeGenerateRequest(body)`

Accepts either snake_case or camelCase (CreateEventFlow payload or legacy
page.tsx submit path) and returns `NormalizedGenerateInput`, where **every field
resolves to a concrete value (never `undefined`)** so DB writes can't silently
drop keys. `isEditing` is true only when both `isEditing` and `editingId` are
present. `invitationVideoUrl` is always the newline-joined scalar, never
truncated to a single URL.

## Migration guidance (input → canonical package)

1. Move the constants, helpers, interfaces, and functions above into
   `packages/event-contract` **unchanged**.
2. Re-export from `eventcast-admin/src/lib/eventContract.ts` during transition so
   existing imports keep resolving.
3. Point the contract tests in `eventcast-admin/tests/contract/` at the package.
4. Only after consumers are switched, consider removing the compatibility
   re-export — a separate, reviewed step.

No field renames, additions, or removals are authorized as part of the move.
