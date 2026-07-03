# 10 — Official References

**Reference review date:** 2026-07-02

These sources were used to verify the baseline. Implementation should re-check release-specific syntax when a dependency is upgraded.

## SRS

SRS GitHub releases, including stable `v6.0-r0`:  
https://github.com/ossrs/srs/releases

SRS introduction and supported protocols:  
https://ossrs.io/lts/en-us/docs/v6/doc/introduction

SRS RTMP documentation:  
https://ossrs.io/lts/en-us/docs/v7/doc/rtmp

SRS HLS configuration, cleanup, callbacks, DVR window, and segment behavior (documentation must be checked against pinned v6 image):  
https://ossrs.io/lts/en-us/docs/v7/doc/hls

SRS v6 HTTP callback payloads and response semantics:  
https://ossrs.io/lts/en-us/docs/v6/doc/http-callback

SRS HTTP callbacks and `on_hls` payload fields:  
https://ossrs.io/lts/en-us/docs/v5/doc/http-callback

SRS SRT documentation:  
https://ossrs.io/lts/en-us/docs/v6/doc/srt

SRS HEVC support and compatibility cautions:  
https://ossrs.io/lts/en-us/docs/v6/doc/hevc

SRS Prometheus/OpenMetrics exporter:  
https://ossrs.io/lts/en-us/docs/v7/doc/exporter

## Cloudflare R2 and cache

R2 architecture and strong consistency overview:  
https://developers.cloudflare.com/r2/how-r2-works/

R2 consistency model:  
https://developers.cloudflare.com/r2/reference/consistency/

R2 durability and availability concepts:  
https://developers.cloudflare.com/r2/reference/durability/

R2 S3-compatible API:  
https://developers.cloudflare.com/r2/get-started/s3/

R2 public buckets, custom domains, cache, and `r2.dev` production warning:  
https://developers.cloudflare.com/r2/buckets/public-buckets/

R2 custom-domain caching weakens consistency and may cache 404 responses:  
https://developers.cloudflare.com/r2/reference/consistency/

R2 CORS behavior for custom domains:  
https://developers.cloudflare.com/r2/buckets/cors/

R2 pricing:  
https://developers.cloudflare.com/r2/pricing/

R2 lifecycle rules:  
https://developers.cloudflare.com/r2/buckets/object-lifecycles/

Cloudflare Cache documentation:  
https://developers.cloudflare.com/cache/

Cloudflare Service-Specific Terms for video and large-file delivery:  
https://www.cloudflare.com/service-specific-terms-application-services/

Cloudflare terms clarification describing Developer Platform services:  
https://blog.cloudflare.com/updated-tos/

## Wasabi

Wasabi S3 API compatibility:  
https://docs.wasabi.com/apidocs/api-guides

Wasabi minimum storage duration policy:  
https://docs.wasabi.com/docs/how-does-wasabis-minimum-storage-duration-policy-work

Wasabi monthly minimum storage charge:  
https://docs.wasabi.com/docs/how-does-wasabis-monthly-minimum-storage-charge-work

Wasabi lifecycle configuration:  
https://docs.wasabi.com/docs/how-do-i-configure-object-lifecycle-policies-with-wasabi

## HLS standard

IETF RFC 8216 — HTTP Live Streaming:  
https://www.rfc-editor.org/rfc/rfc8216

## Interpretation note

Official documentation confirms that SRS can convert RTMP or SRT to HLS, emit callbacks after HLS segments are reaped, disable automatic segment cleanup for custom storage management, expose metrics, and support HEVC in SRS 6. Cloudflare documents R2 as S3-compatible, strongly consistent object storage with custom-domain cache support and identifies the Developer Platform as an appropriate paid service category for video/large-file delivery. Wasabi documents S3 compatibility and its default Pay-as-You-Go minimum storage duration.

These sources validate the components, but EventCast reliability still depends on the ordered uploader, durable queue, manifest ownership, tests, and operations defined in this baseline.
