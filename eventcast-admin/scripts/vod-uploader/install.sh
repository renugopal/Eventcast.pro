#!/bin/bash
# Install live VOD uploader on GCP Restreamer VM
set -euo pipefail

INSTALL_DIR="/opt/eventcast/vod-uploader"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Eventcast VOD Uploader Install ==="
echo "Source: $SCRIPT_DIR"
echo "Target: $INSTALL_DIR"

sudo mkdir -p "$INSTALL_DIR"
sudo cp -r "$SCRIPT_DIR"/* "$INSTALL_DIR"/
sudo rm -f "$INSTALL_DIR/install.sh"

cd "$INSTALL_DIR"
sudo npm install --omit=dev

if [ ! -f "$INSTALL_DIR/.env" ]; then
  sudo cp "$INSTALL_DIR/.env.example" "$INSTALL_DIR/.env"
  echo ""
  echo "⚠️  Edit $INSTALL_DIR/.env with your credentials before starting:"
  echo "   sudo nano $INSTALL_DIR/.env"
fi

sudo mkdir -p /var/lib/eventcast-uploader/state
sudo cp "$INSTALL_DIR/vod-uploader.service" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable vod-uploader

echo ""
echo "✅ Installed. Next steps:"
echo "   1. sudo nano $INSTALL_DIR/.env"
echo "   2. sudo systemctl start vod-uploader"
echo "   3. sudo journalctl -u vod-uploader -f"
echo ""
echo "After event:"
echo "   cd $INSTALL_DIR && sudo node finalize-vod.mjs <event-slug>"
