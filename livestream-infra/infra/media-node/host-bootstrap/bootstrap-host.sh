#!/usr/bin/env bash
# EventCast media-node host bootstrap. Run as root over an existing SSH session.
#
# This script deliberately does not touch SSH daemon policy, UFW, cloud
# firewall rules, EventCast application files, Compose environment files, or
# containers. It stops after package maintenance if a reboot is required.

set -Eeuo pipefail
umask 027

ADMIN_USER="eventcast-admin"
HOSTNAME_VALUE="eventcast-media-node-akm-01"
MEDIA_NODE_ROOT="/opt/eventcast/media-node"

log() { printf '[host-bootstrap] %s\n' "$*" >&2; }
fail() { printf '[host-bootstrap][FAIL] %s\n' "$*" >&2; exit 1; }

if [[ "${1:-}" != "--apply" || "$#" -ne 1 ]]; then
  printf '%s\n' \
    'Usage: bootstrap-host.sh --apply' \
    '' \
    'This mutates only the approved host-bootstrap scope. It does not start' \
    'EventCast containers or modify SSH policy, UFW, cloud firewall rules, or' \
    'secret-bearing application configuration.' >&2
  exit 2
fi

[[ "$(id -u)" -eq 0 ]] || fail "run as root"
[[ -n "${SSH_CONNECTION:-}" ]] || fail "run from an existing SSH session"
[[ "$(hostname)" == "localhost" ]] || fail "unexpected hostname; refusing to overwrite host state"
! getent passwd "$ADMIN_USER" >/dev/null || fail "admin account already exists; refusing to alter it"
[[ ! -e "$MEDIA_NODE_ROOT" ]] || fail "media-node root already exists; refusing to alter it"
[[ ! -e /etc/sudoers.d/eventcast-admin ]] || fail "admin sudoers file already exists; refusing to alter it"
[[ ! -e /etc/systemd/system/eventcast-media-node.service ]] || fail "EventCast systemd unit already exists; refusing to alter it"
[[ ! -e /etc/apt/keyrings/docker.asc ]] || fail "Docker signing key already exists; refusing to alter it"
[[ ! -e /etc/apt/sources.list.d/docker.list ]] || fail "Docker package source already exists; refusing to alter it"
! command -v docker >/dev/null 2>&1 || fail "Docker is already installed; refusing to alter it"
[[ -s /root/.ssh/authorized_keys ]] || fail "root authorized_keys is missing or empty"

export DEBIAN_FRONTEND=noninteractive

log "refreshing Ubuntu package metadata"
apt-get update
log "installing available Ubuntu package upgrades"
apt-get -y upgrade

if [[ -e /var/run/reboot-required ]]; then
  log "reboot is required; stopping before hostname, account, Docker, filesystem, or systemd changes"
  exit 75
fi

log "setting hostname to ${HOSTNAME_VALUE}"
hostnamectl set-hostname "$HOSTNAME_VALUE"

log "creating non-root administrative account"
adduser --disabled-password --gecos '' --shell /bin/bash "$ADMIN_USER"

usermod -a -G sudo "$ADMIN_USER"
install -d -m 0700 -o "$ADMIN_USER" -g "$ADMIN_USER" "/home/${ADMIN_USER}/.ssh"

admin_authorized_keys="/home/${ADMIN_USER}/.ssh/authorized_keys"
log "copying the already-authorized root public key set to the new admin account"
install -m 0600 -o "$ADMIN_USER" -g "$ADMIN_USER" /root/.ssh/authorized_keys "$admin_authorized_keys"

install -d -m 0750 -o root -g root /etc/sudoers.d
cat >/etc/sudoers.d/eventcast-admin <<'SUDOERS'
eventcast-admin ALL=(ALL:ALL) NOPASSWD: ALL
SUDOERS
chmod 0440 /etc/sudoers.d/eventcast-admin
visudo -cf /etc/sudoers.d/eventcast-admin >/dev/null

log "installing Docker Engine and Compose from Docker's Ubuntu repository"
apt-get install -y ca-certificates curl
install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
. /etc/os-release
printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu %s stable\n' \
  "$(dpkg --print-architecture)" "$VERSION_CODENAME" >/etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker

log "creating root-owned EventCast directory skeleton without application or secret files"
for directory in \
  "$MEDIA_NODE_ROOT" \
  "$MEDIA_NODE_ROOT/app" \
  "$MEDIA_NODE_ROOT/config" \
  "$MEDIA_NODE_ROOT/config/srs" \
  "$MEDIA_NODE_ROOT/config/assignments" \
  "$MEDIA_NODE_ROOT/data" \
  "$MEDIA_NODE_ROOT/data/spool" \
  "$MEDIA_NODE_ROOT/data/db" \
  "$MEDIA_NODE_ROOT/data/srs" \
  "$MEDIA_NODE_ROOT/backups"
do
  install -d -m 0750 -o root -g root "$directory"
done

log "installing disabled EventCast systemd unit"
cat >/etc/systemd/system/eventcast-media-node.service <<'UNIT'
[Unit]
Description=EventCast Media Node Compose Stack
Wants=network-online.target
After=network-online.target docker.service
Requires=docker.service
ConditionPathExists=/opt/eventcast/media-node/app/compose/docker-compose.yml
ConditionPathExists=/opt/eventcast/media-node/app/compose/.env

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/eventcast/media-node/app/compose
ExecStartPre=/usr/bin/docker compose --project-name eventcast-media-node --env-file /opt/eventcast/media-node/app/compose/.env -f /opt/eventcast/media-node/app/compose/docker-compose.yml config --quiet
ExecStart=/usr/bin/docker compose --project-name eventcast-media-node --env-file /opt/eventcast/media-node/app/compose/.env -f /opt/eventcast/media-node/app/compose/docker-compose.yml up --detach --remove-orphans
ExecStop=/usr/bin/docker compose --project-name eventcast-media-node --env-file /opt/eventcast/media-node/app/compose/.env -f /opt/eventcast/media-node/app/compose/docker-compose.yml stop
TimeoutStartSec=120
TimeoutStopSec=120

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload

log "bootstrap completed; EventCast service remains disabled and no containers were started"
