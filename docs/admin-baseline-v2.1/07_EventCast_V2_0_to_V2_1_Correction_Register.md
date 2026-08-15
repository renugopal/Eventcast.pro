# EventCast.pro Admin Baseline - Version 2.0 to Version 2.1 Correction Register

**Prepared:** 8 August 2026  
**Scope:** Controlled documentation correction pass only  
**Product-scope impact:** None. The approved first implementation slice is unchanged.

## 1. Navigation correction

The consolidated DOCX and PDF now contain a visible, deterministic Table of Contents with real entries. The empty Table of Contents heading from Version 2.0 is removed.

## 2. Business-root decision added

The URL model now explicitly requires `business.eventcast.pro/` to resolve to a simple branded landing page or safe placeholder. This may show business identity, contact links, and selected public events. It remains separate from event templates and does not require a full website builder.

## 3. EventCast Direct operations decision added

The Decision Register now records private operational data for EventCast Direct orders: assigned operator, equipment plan or checklist, venue contact, travel and arrival notes, and internal handoff state. These fields never enter the Public Event Config, public Event Credits, SEO metadata, or guest-facing page.

## 4. Architecture diagrams corrected

The Target Product Architecture and Livestream/VOD diagrams now show the Media Agent and recording-finalization path writing to B2. The Cloudflare Worker/CDN is shown as the public rendering and playback-delivery layer, not as the process that creates the authoritative recording.

The URL diagram now includes the business-subdomain root landing page, the neutral EventCast link, future customer-domain forms, EventCast Direct usage, and reserved infrastructure-host exclusions.

## 5. Editorial corrections

The phrase "Build new the Event Workspace" is corrected. YouTube decision codes are ordered numerically, with YTB-008 before YTB-009. Version references, file names, package metadata, checksums, and QA records are updated to Version 2.1.

## 6. Decisions not reopened

Version 2.1 does not reopen or change the Next.js framework decision, SRS and Media Agent target, Restreamer retirement, canonical event contract, canonical template package, GrapesJS removal, Layer Studio preservation, billing deferral, VOD retention, Guest Memories policy, URL model, Supabase schema findings, or the Route-Based Draft Event Foundation scope.
