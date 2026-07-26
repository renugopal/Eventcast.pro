# Media Agent v1.0.0 Bootstrap Record

This document is the permanent record of the one-time bootstrap event that
established the private `eventcast-media-agent-private` GHCR package. It is a
historical document. No action described here may be repeated; the bootstrap
path no longer exists in the release workflow.

## What bootstrap means

The first publication of a user-owned container package to GHCR inherits the
visibility of the source repository. Because `renugopal/Eventcast.pro` is
public, the first push created the package as public. There is no documented
REST or GraphQL API to change the visibility of a user-owned GHCR container
package programmatically. Visibility must be set manually in the GitHub Package
Settings UI immediately after the first push.

There is no supported mechanism for the release workflow to perform this
visibility change. Bootstrap is a permanent manual-only one-time event. The
normal release workflow (all runs after v1.0.0) requires the package to already
exist with private visibility.

## v1.0.0 bootstrap event (2026-07-26)

**Workflow run:** `30174042836`
**Trigger:** manual `workflow_dispatch` on `main` at commit
`1e6142d9b5b10af38c1c668272ae37accfb49a5d`

All pre-publish gates passed. The image was built and pushed successfully. The
post-publish visibility check failed with the message
`published package visibility is not private` because GHCR assigned public
visibility to the newly created package.

**Manual correction:** The package `eventcast-media-agent-private` was set to
private visibility in the GitHub GHCR Package Settings UI by the account owner
(`renugopal`).

**Recovery evidence:** The release manifest and checksum were reconstructed
from directly verified registry metadata and committed to
`releases/eventcast-media-agent-v1.0.0-1e6142d9b5b1.release` and
`releases/eventcast-media-agent-v1.0.0-1e6142d9b5b1.release.sha256`.

## v1.0.0 is the chain anchor

The committed v1.0.0 manifest (`format=eventcast-media-agent-release-v1`)
uses the bootstrap-only v1 schema (five fields). Its `image_reference` value:

```
ghcr.io/renugopal/eventcast-media-agent-private@sha256:4d3c65b38843c89c97f81cab631183442b52ed7cd8a308941f8222eb385b77da
```

is the value that must be supplied as `previous_image_reference` when
dispatching the v1.0.1 release workflow run.

Gate P-6 will verify that the GHCR version object with this digest also carries
the tag `v1.0.0-1e6142d9b5b1`, confirming it is an active, tagged release
rather than an orphaned or deleted version.

## What is permanently prohibited

- Re-running the bootstrap path. The workflow no longer contains a first-publish
  404-gate. All future runs require an existing private package.
- Publishing under the old public package name
  `ghcr.io/renugopal/eventcast-media-agent`. That package is permanently
  excluded from all deployment and rollback references.
- Modifying the committed v1.0.0 evidence files. They are the immutable chain
  anchor and must never be altered.
