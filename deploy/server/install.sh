#!/usr/bin/env bash
# Schützenhaus PMS auf einem eigenen Linux-Server (z. B. IONOS VPS mit Ubuntu 22.04 oder 24.04) einrichten.
#
#   sudo bash install.sh pms.mein-hotel.de
#
# Richtet ein: PostgreSQL, Node.js 22, das PMS als Dienst (Benutzer „pms“), Caddy mit automatischem HTTPS-Zertifikat,
# tägliche Datensicherung nach /var/backups/pms und den Befehl „pms-update“.
# Voraussetzung: Die Domain zeigt bereits auf die IP-Adresse dieses Servers (A-Eintrag), Ports 80 und 443 sind erreichbar.
#
# NICHT AUF EINEM ECHTEN SERVER ERPROBT – bitte zuerst auf einem frischen Server ohne echte Daten ausprobieren.
set -euo pipefail

DOMAIN="${1:-}"
REPO="jiuh9uio/Pms"
[ "$(id -u)" = 0 ] || { echo "Bitte mit sudo ausführen."; exit 1; }
[[ "$DOMAIN" =~ ^[a-z0-9.-]+\.[a-z]{2,}$ ]] || { echo "Aufruf: sudo bash install.sh pms.mein-hotel.de"; exit 1; }
[ -e /opt/pms/current ] && { echo "Das PMS ist hier schon installiert. Zum Aktualisieren: sudo pms-update"; exit 1; }

echo "== Pakete installieren"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl ca-certificates gnupg postgresql debian-keyring debian-archive-keyring apt-transport-https ufw
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
fi

echo "== Benutzer, Ordner und Datenbank"
id pms >/dev/null 2>&1 || useradd --system --home /opt/pms --shell /usr/sbin/nologin pms
install -d -o pms -g pms /opt/pms /opt/pms/releases /var/lib/pms
install -d -o pms -g pms -m 700 /var/backups/pms
DB_PASS="$(openssl rand -hex 24)"
sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE ROLE pms LOGIN PASSWORD '${DB_PASS}'" -c "CREATE DATABASE pms OWNER pms"
sudo -u postgres psql -v ON_ERROR_STOP=1 -d pms -c "CREATE EXTENSION IF NOT EXISTS btree_gist"

cat > /etc/pms.env <<ENV
DATABASE_URL=postgres://pms:${DB_PASS}@127.0.0.1:5432/pms
HOST=127.0.0.1
PORT=3000
COOKIE_SECURE=true
PUBLIC_URL=https://${DOMAIN}
PMS_DATA_DIR=/var/lib/pms
BACKUP_DIR=/var/backups/pms
BACKUP_KEEP=30
# Gehosteter Betrieb: keine Suche nach Geräten im Netz des Rechenzentrums
PMS_HOSTED=true
ENV
chown root:pms /etc/pms.env && chmod 640 /etc/pms.env

echo "== Dienste einrichten"
install -m 755 "$(dirname "$0")/pms-update.sh" /usr/local/bin/pms-update
cat > /etc/systemd/system/pms.service <<UNIT
[Unit]
Description=Schuetzenhaus PMS
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
User=pms
Group=pms
WorkingDirectory=/opt/pms/current
EnvironmentFile=/etc/pms.env
ExecStart=/usr/bin/node dist/server/index.js
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/systemd/system/pms-backup.service <<UNIT
[Unit]
Description=Schuetzenhaus PMS Datensicherung

[Service]
Type=oneshot
User=pms
WorkingDirectory=/opt/pms/current
EnvironmentFile=/etc/pms.env
ExecStart=/usr/bin/node scripts/backup.mjs
UNIT
cat > /etc/systemd/system/pms-backup.timer <<UNIT
[Unit]
Description=Schuetzenhaus PMS Datensicherung taeglich

[Timer]
OnCalendar=*-*-* 02:30:00
Persistent=true

[Install]
WantedBy=timers.target
UNIT
cat > /etc/caddy/Caddyfile <<CADDY
${DOMAIN} {
	encode gzip
	reverse_proxy 127.0.0.1:3000
}
CADDY

echo "== Programm laden und bauen"
PMS_FIRST_INSTALL=1 /usr/local/bin/pms-update

echo "== Firewall: nur SSH, HTTP und HTTPS"
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable

systemctl daemon-reload
systemctl enable --now pms.service pms-backup.timer
systemctl reload caddy || systemctl restart caddy

echo
echo "Fertig. Das PMS ist in etwa einer Minute erreichbar unter: https://${DOMAIN}"
echo "Dort zuerst das Administrator-Konto anlegen – solange keines besteht, kann das jeder tun, der die Adresse kennt."
echo "Aktualisieren: sudo pms-update     Sicherungen: /var/backups/pms (bitte zusätzlich außerhalb des Servers aufbewahren)"
