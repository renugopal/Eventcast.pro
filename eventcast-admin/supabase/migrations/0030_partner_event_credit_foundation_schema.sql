-- 0030_partner_event_credit_foundation_schema.sql
--
-- Foundational schema for Baseline V2.1 Partner / Event Credit (PART-001..PART-008).
-- Additive only. Does NOT touch the existing `photographers` table or
-- `events.photographer_id`, which remain fully intact and unchanged.
--
-- Live-schema preflight evidence this migration is based on (read-only,
-- verified via `supabase db query --linked` against the linked project,
-- scoped strictly to `photographers` and `events.photographer_id`):
--   - photographers: id uuid pk default uuid_generate_v4(), studio_id uuid
--     not null fk -> studios(id) on delete cascade, name/phone_number not
--     null, studio_name/city/instagram_url/phone/logo_url/nickname nullable
--     (studio_name and phone are dead columns, unreferenced by any
--     application code found in this repository), a GLOBAL unique
--     constraint on phone_number (not studio-scoped -- a real cross-tenant
--     collision risk), and no index on studio_id itself.
--   - events.photographer_id: uuid, nullable, fk `events_photographer_id_fkey`
--     -> photographers(id) with NO `ON DELETE` clause (i.e. NO ACTION):
--     deleting a still-referenced photographer is blocked by Postgres, not
--     silently orphaned/cascaded.
--   - photographers RLS: enabled (relrowsecurity = true), 4 tenant-scoped
--     policies matching migration 0003 (select/insert/update/delete scoped
--     to studio_members), PLUS two undocumented policies not present in any
--     tracked migration: "Admin full access on photographers" (ALL, for any
--     authenticated user regardless of studio) and "Public can view
--     photographers" (SELECT, unrestricted/anonymous). These two are a live
--     cross-tenant/public-exposure security finding on the legacy table.
--     They are deliberately NOT reproduced in this migration's new policies
--     and are NOT modified here -- flagged as a separate follow-up, out of
--     scope for this foundational schema task.
--
-- This migration intentionally does NOT:
--   - rename, drop, or alter `photographers` or `events.photographer_id`
--   - add an `approved`/moderation column to `event_credits` (no moderation
--     workflow exists yet; Baseline PART-008's "approved" publish-time gate
--     belongs to the later Publish task, not this schema foundation)
--   - populate, freeze, read, or otherwise touch `events.published_credits`
--     (Publish-time snapshot logic is a separate later task)
--   - touch eventContract.ts, the renderer, the render Worker, or any API/UI

-- ---------------------------------------------------------------------------
-- 1. partners -- reusable, studio-owned Partner/Client master identity
--    (Baseline V2.1 PART-001, PART-002, PART-003)
-- ---------------------------------------------------------------------------

create table if not exists public.partners (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,

  -- Directory relationship type (Master Baseline S13: "photographers,
  -- studios, event managers, direct clients, venues, and other
  -- relationships").
  partner_type text not null check (
    partner_type in ('photographer', 'studio', 'event_manager', 'client', 'venue', 'other')
  ),

  -- Public-safe fields (PART-002). Safe, in principle, to be copied into a
  -- future public Event Credit snapshot (events.published_credits).
  business_name text not null,
  contact_person text,
  phone text,
  whatsapp text,
  city text,
  instagram_url text,
  facebook_url text,
  youtube_url text,
  website_url text,
  logo_url text,

  -- Private/internal field (PART-003). Must never be selected into
  -- PublicEventConfig, the renderer, or any public Event Credit snapshot.
  internal_notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.partners is
  'Studio-owned reusable Partner/Client directory (Baseline V2.1 PART-001/PART-002). Superset of the legacy photographers table; photographers is left untouched by this migration.';
comment on column public.partners.internal_notes is
  'Private/internal only (PART-003). Never select this column into PublicEventConfig, the renderer, or any public Event Credit snapshot.';
comment on column public.partners.updated_at is
  'Application-maintained on write. No trigger is added by this migration (avoiding speculative structure beyond what this foundational task requires).';

-- Deliberately no unique constraint on phone/whatsapp: the legacy
-- photographers_phone_number_key was a GLOBAL unique constraint that blocked
-- two different studios from registering the same phone number, which is
-- not a real identity invariant this feature needs and is not carried
-- forward.

create index if not exists idx_partners_studio_id on public.partners (studio_id);

alter table public.partners enable row level security;

-- Tenant-scoped RLS mirroring photographers' correct (migration 0003)
-- shape -- deliberately NOT reproducing the two undocumented broad-access
-- policies found live on photographers (see header note).

drop policy if exists partners_select_policy on public.partners;
create policy partners_select_policy on public.partners
  for select
  using (
    studio_id in (
      select studio_members.studio_id
      from public.studio_members
      where studio_members.user_id = auth.uid()
    )
  );

drop policy if exists partners_insert_policy on public.partners;
create policy partners_insert_policy on public.partners
  for insert
  with check (
    studio_id in (
      select studio_members.studio_id
      from public.studio_members
      where studio_members.user_id = auth.uid()
        and studio_members.role = any (array['owner', 'admin']::member_role_enum[])
    )
  );

drop policy if exists partners_update_policy on public.partners;
create policy partners_update_policy on public.partners
  for update
  using (
    studio_id in (
      select studio_members.studio_id
      from public.studio_members
      where studio_members.user_id = auth.uid()
        and studio_members.role = any (array['owner', 'admin']::member_role_enum[])
    )
  )
  with check (
    studio_id in (
      select studio_members.studio_id
      from public.studio_members
      where studio_members.user_id = auth.uid()
        and studio_members.role = any (array['owner', 'admin']::member_role_enum[])
    )
  );

drop policy if exists partners_delete_policy on public.partners;
create policy partners_delete_policy on public.partners
  for delete
  using (
    studio_id in (
      select studio_members.studio_id
      from public.studio_members
      where studio_members.user_id = auth.uid()
        and studio_members.role = any (array['owner', 'admin']::member_role_enum[])
    )
  );

-- ---------------------------------------------------------------------------
-- 2. event_credits -- editable event-to-partner credit references
--    (Baseline V2.1 PART-004, PART-005)
-- ---------------------------------------------------------------------------

create table if not exists public.event_credits (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  partner_id uuid not null references public.partners(id),

  -- Role label shown in the eventual public Event Credit (PART-005). Same
  -- approved set as partners.partner_type; a partner's default type does
  -- not have to match the role_label it is credited under on a given event.
  role_label text not null check (
    role_label in ('photographer', 'studio', 'event_manager', 'client', 'venue', 'other')
  ),

  is_primary boolean not null default false,

  created_at timestamptz not null default now()
);

comment on table public.event_credits is
  'Editable event-to-partner Event Credit references (Baseline V2.1 PART-005). Reference-only -- no public snapshot data is stored here; see events.published_credits for the future frozen snapshot written by the Publish task.';

-- No `on delete` clause on partner_id, deliberately matching the verified
-- legacy events_photographer_id_fkey behavior: deleting a partner still
-- credited on an event is blocked (NO ACTION) rather than silently
-- cascading or orphaning the reference.

-- At most one primary credit per event.
create unique index if not exists event_credits_one_primary_per_event
  on public.event_credits (event_id)
  where is_primary;

-- Prevent an exact duplicate Event Credit: the same partner credited under
-- the same role label on the same event more than once. Does not restrict
-- the same partner appearing under a different role label on the same
-- event, or on a different event, or a different partner on the same event.
create unique index if not exists event_credits_unique_event_partner_role
  on public.event_credits (event_id, partner_id, role_label);

create index if not exists idx_event_credits_event_id on public.event_credits (event_id);
create index if not exists idx_event_credits_partner_id on public.event_credits (partner_id);

alter table public.event_credits enable row level security;

-- Tenant isolation is derived entirely from the owning event's studio_id via
-- `events` and `studio_members` -- no redundant studio_id column is stored
-- on this table (event_credits has no studio_id of its own; ownership is
-- always resolved through the referenced event). Insert/update additionally
-- require the referenced partner to belong to that same event's studio_id,
-- which is what prevents a Studio A event from being credited to a
-- Studio B partner.

drop policy if exists event_credits_select_policy on public.event_credits;
create policy event_credits_select_policy on public.event_credits
  for select
  using (
    exists (
      select 1
      from public.events e
      join public.studio_members sm on sm.studio_id = e.studio_id
      where e.id = event_credits.event_id
        and sm.user_id = auth.uid()
    )
  );

drop policy if exists event_credits_insert_policy on public.event_credits;
create policy event_credits_insert_policy on public.event_credits
  for insert
  with check (
    exists (
      select 1
      from public.events e
      join public.studio_members sm on sm.studio_id = e.studio_id
      where e.id = event_credits.event_id
        and sm.user_id = auth.uid()
        and sm.role = any (array['owner', 'admin']::member_role_enum[])
    )
    and exists (
      select 1
      from public.partners p
      join public.events e on e.id = event_credits.event_id
      where p.id = event_credits.partner_id
        and p.studio_id = e.studio_id
    )
  );

drop policy if exists event_credits_update_policy on public.event_credits;
create policy event_credits_update_policy on public.event_credits
  for update
  using (
    exists (
      select 1
      from public.events e
      join public.studio_members sm on sm.studio_id = e.studio_id
      where e.id = event_credits.event_id
        and sm.user_id = auth.uid()
        and sm.role = any (array['owner', 'admin']::member_role_enum[])
    )
  )
  with check (
    exists (
      select 1
      from public.events e
      join public.studio_members sm on sm.studio_id = e.studio_id
      where e.id = event_credits.event_id
        and sm.user_id = auth.uid()
        and sm.role = any (array['owner', 'admin']::member_role_enum[])
    )
    and exists (
      select 1
      from public.partners p
      join public.events e on e.id = event_credits.event_id
      where p.id = event_credits.partner_id
        and p.studio_id = e.studio_id
    )
  );

drop policy if exists event_credits_delete_policy on public.event_credits;
create policy event_credits_delete_policy on public.event_credits
  for delete
  using (
    exists (
      select 1
      from public.events e
      join public.studio_members sm on sm.studio_id = e.studio_id
      where e.id = event_credits.event_id
        and sm.user_id = auth.uid()
        and sm.role = any (array['owner', 'admin']::member_role_enum[])
    )
  );

-- ---------------------------------------------------------------------------
-- 3. events.published_credits -- future public Event Credit snapshot storage
--    (Baseline V2.1 PART-006)
-- ---------------------------------------------------------------------------

alter table public.events
  add column if not exists published_credits jsonb;

comment on column public.events.published_credits is
  'Frozen public Event Credit snapshot (Baseline V2.1 PART-006), written only by the future Publish action. Nullable and unused until that task defines its exact shape and freeze logic. Never read from partners/event_credits live at render time -- PublicEventConfig must read only this column once populated.';
