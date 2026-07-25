# EventCast media-node host bootstrap

This directory provides the provider-neutral, first host-bootstrap step for an
Ubuntu media node. It is intentionally separate from application deployment.

## Scope

`bootstrap-host.sh --apply` must be run as `root` through an existing SSH
session. It:

- refreshes and upgrades Ubuntu packages;
- stops with exit code `75` if Ubuntu reports that a reboot is required;
- sets the host name to `eventcast-media-node-akm-01`;
- creates the `eventcast-admin` account with passwordless `sudo` and copies
  the already-authorized root public-key set without printing it;
- installs Docker Engine and the Compose plugin from Docker's Ubuntu
  repository;
- creates a root-owned, mode-`0750` `/opt/eventcast/media-node` skeleton;
- installs the disabled `eventcast-media-node.service` unit and reloads
  systemd.

The script is deliberately strict for the fresh-host path. It stops before any
mutation if the hostname, admin account, Docker installation markers, EventCast
paths, or unit file already exist, rather than guessing how to preserve them.

When invoking it from Windows PowerShell over standard input, normalize the
transfer stream to LF so the remote shell does not receive PowerShell's line
endings:

```powershell
$script = (Get-Content -LiteralPath .\bootstrap-host.sh -Raw) -replace "`r`n", "`n"
$script | ssh root@media-node "bash -s -- --apply"
```

Use the already configured SSH client identity; do not add a key path,
password, or secret to this command.

## Explicit exclusions

This bootstrap does not modify SSH daemon policy, UFW, cloud firewall rules,
DNS, or provider resources. It does not create an EventCast `.env`, copy an
application artifact, pull an image, start a container, create credentials,
register a node, configure R2/B2/YouTube, or activate an assignment.

The service unit has conditions for both the future Compose file and its
environment file, and bootstrap does not enable or start it. Writable media
directory ownership remains `root:root` until a separate approved release
step verifies the exact runtime users of the pinned images.

## Required post-bootstrap checks

Before any SSH hardening, open a separate SSH session as `eventcast-admin` and
verify `sudo -n true`. Keep the established root session open until that check
passes. A reboot, SSH policy hardening, firewall restriction, application
release, immutable-image pull, and Compose start each require separate
approval.
