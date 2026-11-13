#!/usr/bin/env bash
# Lädt die neueste veröffentlichte Version des PMS, baut sie, sichert die Daten und schaltet um.
# Schlägt der Start der neuen Version fehl, wird auf die vorherige zurückgeschaltet.
set -euo pipefail
REPO="jiuh9uio/Pms"
[ "$(id -u)" = 0 ] || { echo "Bitte mit sudo ausführen."; exit 1; }

TAG="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -1)"
[ -n "$TAG" ] || { echo "Die neueste Version konnte nicht ermittelt werden (Internet erreichbar?)."; exit 1; }
DIR="/opt/pms/releases/${TAG}"
CURRENT="$(readlink -f /opt/pms/current 2>/dev/null || true)"
if [ "$CURRENT" = "$DIR" ]; then echo "Version ${TAG} ist bereits installiert."; exit 0; fi

echo "== Version ${TAG} laden und bauen"
rm -rf "$DIR" && install -d -o pms -g pms "$DIR"
curl -fsSL "https://github.com/${REPO}/archive/refs/tags/${TAG}.tar.gz" | sudo -u pms tar -xz --strip-components=1 -C "$DIR"
( cd "$DIR" && sudo -u pms env HOME=/opt/pms npm ci --no-audit --no-fund && sudo -u pms env HOME=/opt/pms npm run build )

if [ -z "${PMS_FIRST_INSTALL:-}" ]; then
  echo "== Datensicherung vor dem Update"
  systemctl start pms-backup.service
  systemctl stop pms.service
fi
ln -sfn "$DIR" /opt/pms/current
[ -n "${PMS_FIRST_INSTALL:-}" ] && exit 0

systemctl start pms.service
for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3000/api/v1/health >/dev/null 2>&1; then echo "Version ${TAG} läuft."; exit 0; fi
  sleep 2
done
echo "FEHLER: Die neue Version startet nicht – zurück auf die vorherige. Näheres: journalctl -u pms -n 50"
if [ -n "$CURRENT" ]; then ln -sfn "$CURRENT" /opt/pms/current; systemctl restart pms.service; fi
echo "Hinweis: Hat die neue Version die Datenbank bereits umgestellt, muss die Sicherung von vor dem Update eingespielt werden (npm run restore)."
exit 1
