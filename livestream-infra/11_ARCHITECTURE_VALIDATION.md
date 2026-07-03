# 11 — Architecture Validation Record

## Review method

This baseline was reconstructed from zero rather than preserving the previous Restreamer design. The review compared EventCast's long-duration event requirements against current official SRS, Cloudflare R2, Cloudflare cache/terms, Wasabi, and HLS documentation. It separately examined ingest reliability, segment durability, playlist correctness, viewer scaling, DVR, VOD, archive transfer, reconnects, control-plane outages, node failures, and future SRT/H.265 expansion.

## Resolved contradictions

The old idea of local-server HLS served through generic Cloudflare CDN has been replaced by R2-hosted objects delivered through an R2 custom domain. The old idea of publishing SRS's playlist directly has been replaced by a Media Agent manifest that references only confirmed R2 objects. The old idea of a single long MP4 as the recording has been replaced by immutable HLS segments as the canonical recording and an optional MP4 derivative.

Restreamer has been replaced by SRS because the platform requires programmable callbacks and multi-event orchestration. Wasabi has been placed after VOD finalization as archive storage rather than in the live viewer path. SRT and H.265 have been retained as a planned premium direction but removed from V1 production scope.

## Reliability assessment

The design is technically sound for EventCast's expected early scale when implemented exactly as specified. R2 strong consistency and S3-compatible uploads are suitable for immutable segments. Cloudflare cache removes viewer traffic from the media server. The Media Agent's protected spool and SQLite queue protect completed media during temporary R2 and process failures, independently of SRS cleanup on shutdown. The archive workflow avoids destructive moves.

The most important reliability property is application-enforced: the public playlist cannot advance until the referenced segment is confirmed in R2. The second is deletion safety: local or R2 copies cannot be removed before the next required durable copy is verified.

## Known limits accepted for V1

V1 has a single live origin provider, one source-quality rendition, and no seamless active publisher failover. A prolonged R2/CDN outage can stall viewers. Complete loss of a media node before pending local segments reach R2 can lose those pending segments even with mirrored disks if the entire server becomes unavailable. Weak viewer networks may buffer because there is no ABR. These limits are explicit and are not represented as solved.

## Capacity conclusion

The system scales viewer delivery independently through Cloudflare. Media-node stream capacity depends on ingest bitrate, local writes, R2 uploads, YouTube relay, software behavior, and exact hardware. Ten concurrent streams per node is an intentionally conservative initial scheduler limit. Larger numbers require measured evidence.

## Final-audit corrections in baseline 1.1

The final audit resolved three implementation-level gaps without changing the core architecture. First, V1 now explicitly distinguishes public/unlisted R2 delivery from strict per-viewer authorization. Second, Cloudflare live-manifest cache bypass and prevention of cached manifest 404s are normative requirements. Third, SRS configuration snippets are explicitly behavioral templates that must be validated against the exact pinned image through startup and real callback tests.

The audit also tightened crash durability by requiring directory fsync after hard-link or atomic rename and documenting reconciliation across the unavoidable filesystem/SQLite crash boundary.


## Final consistency corrections in baseline 1.2

A further cross-document audit found and resolved two genuine consistency issues. First, README required Wasabi verification before local deletion for archive-required events while the normative retention section did not. Baseline 1.2 now blocks routine local-spool cleanup until archive verification for those events, with only a tightly controlled audited disk-pressure exception. Second, the archive-manifest contract could be interpreted as requiring the manifest to checksum itself. Baseline 1.2 explicitly excludes the manifest from its payload-object array and stores the manifest's own digest separately.

The README title was also corrected from v1.0 to v1.2 so the displayed title and baseline metadata agree.

## Documentation completeness

The pack defines system boundaries, runtime behavior, data ownership, interfaces, state transitions, storage paths, cache rules, retry semantics, deletion guards, VOD and archive behavior, deployment phases, test gates, incident procedures, and Claude Code rules. No production-critical behavior is intentionally left to an undocumented default.

## Final verdict

This documentation set, baseline version 1.2, is approved as the V1 implementation baseline. Further architecture research is not required before beginning Phase 0 and Phase 1. Changes discovered during implementation must be handled through the documented ADR process rather than informal rewrites.
