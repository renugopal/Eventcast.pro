# EventCast Media Agent image (v1.2 ingest control and durability).
#
# Both stages are pinned by exact tag AND immutable digest per
# 04_TECH_STACK_AND_VERSION_POLICY.md ("Every production dependency
# must be pinned through ... exact image tag plus digest"). Do not
# replace either reference with a floating tag.
#
# internal/store uses modernc.org/sqlite, a pure-Go SQLite driver with
# no CGO dependency, so CGO_ENABLED=0 below and the CGO-free distroless
# runtime stage remain valid unchanged.

# Builder: official pinned Go 1.26.4 toolchain image.
FROM golang:1.26.4@sha256:f96cc555eb8db430159a3aa6797cd5bae561945b7b0fe7d0e284c63a3b291609 AS builder

WORKDIR /src
COPY . .

# Build-time service version reported by GET /healthz. Must be a single
# token (no whitespace); defaults to "dev" for local builds.
ARG MEDIA_AGENT_VERSION=dev

# CGO disabled and a static build keep the binary compatible with the
# distroless runtime stage, which has no libc or shell.
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -trimpath \
    -ldflags="-s -w -X github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/health.Version=${MEDIA_AGENT_VERSION}" \
    -o /out/media-agent ./cmd/media-agent

# Runtime: minimal distroless static image, pinned by tag AND digest.
# It ships a non-root "nonroot" user (65532:65532) and no shell, no
# package manager, and no extra HTTP client - the container
# HEALTHCHECK below uses the binary's own "healthcheck" subcommand
# instead of curl/wget so no additional runtime tool is required.
FROM gcr.io/distroless/static-debian12:nonroot@sha256:d093aa3e30dbadd3efe1310db061a14da60299baff8450a17fe0ccc514a16639

COPY --from=builder /out/media-agent /media-agent

USER nonroot:nonroot

# No public bind by default: EVENTCAST_MEDIA_AGENT_HTTP_ADDR defaults
# to 127.0.0.1:8085 inside the container. EXPOSE is documentation only
# and does not itself publish the port to the host.
EXPOSE 8085

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
    CMD ["/media-agent", "healthcheck"]

ENTRYPOINT ["/media-agent"]
