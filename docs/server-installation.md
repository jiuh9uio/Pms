# Schützenhaus PMS auf einem gemieteten Linux-Server

Stand: Version 1.18.1. **Die Installation ist nicht auf einem echten Server erprobt.** Geprüft ist nur der Kern des
Ablaufs (veröffentlichte Version laden, bauen, mit leerer Datenbank starten). Paketinstallation, Dienste, HTTPS-Zertifikat
und Firewall sind ungetestet – bitte zuerst auf einem frischen Server ohne echte Daten ausprobieren.

## Was gebraucht wird

- Ein **virtueller Server (VPS) mit Root-Zugang**, z. B. bei IONOS, mit Ubuntu 22.04 oder 24.04, mindestens 2 GB
  Arbeitsspeicher. Ein reines „Webhosting“-Paket (Webspace mit PHP) reicht nicht: Das PMS ist ein eigenes Programm mit
  eigener Datenbank und muss dauerhaft laufen.
- Eine **Domain oder Subdomain** (z. B. `pms.mein-hotel.de`), deren A-Eintrag auf die IP-Adresse des Servers zeigt.

## Installation

Per SSH als Administrator anmelden und ausführen:

```bash
curl -fsSL https://github.com/jiuh9uio/Pms/archive/refs/heads/claude/hotel-pms-gmx-0rifkh.tar.gz | tar -xz
sudo bash Pms-*/deploy/server/install.sh pms.mein-hotel.de
```

Danach `https://pms.mein-hotel.de` öffnen und **sofort** das Administrator-Konto anlegen: Solange keines besteht, kann das
jeder tun, der die Adresse kennt.

Eingerichtet werden: PostgreSQL, Node.js 22, das PMS als Dienst `pms` (eigener Benutzer), Caddy als Webserver mit
automatischem HTTPS-Zertifikat, Firewall (nur SSH, 80, 443), tägliche Sicherung um 02:30 Uhr nach `/var/backups/pms`.

## Betrieb

| Aufgabe | Befehl |
|---|---|
| Aktualisieren auf die neueste Version | `sudo pms-update` (sichert vorher, schaltet bei Startfehler zurück) |
| Sicherung sofort | `sudo systemctl start pms-backup.service` |
| Zustand und Meldungen | `systemctl status pms` · `journalctl -u pms -n 100` |
| Passwort vergessen | in `/opt/pms/current`: siehe README, Abschnitt Benutzer (auf dem Server gibt es dafür noch keinen fertigen Befehl) |

## Was auf einem Server im Internet anders ist

- **Geräte im Haus sind nicht erreichbar:** Küchen- und Bondrucker, EC-Gerät und ein TSE-Stick hängen am Hausnetz bzw. an
  einem Rechner im Haus. Von einem Server im Rechenzentrum aus funktionieren Frühstücks- und Schnelldruck, die
  EC-Geräte-Anbindung und die Gerätesuche nicht. Dafür wäre ein kleines Verbindungsprogramm im Haus nötig, das es noch nicht gibt.
- **Die Gerätesuche ist abgeschaltet** (`PMS_HOSTED=true`), damit nicht das Netz des Rechenzentrums durchsucht wird.
- **Sicherungen liegen auf demselben Server.** Sie schützen nicht vor dem Verlust des Servers – bitte regelmäßig herunterladen
  oder zusätzlich die Sicherungsfunktion des Anbieters buchen. Die Sicherungen sind nicht verschlüsselt.
- **Programm-Update und „Datensicherung“ in den Einstellungen** sind Windows-Funktionen; auf dem Server gelten die Befehle oben.
- **Zugangsschutz:** Das PMS ist dann aus dem ganzen Internet erreichbar. Geschützt ist es durch HTTPS, Passwörter und die
  Sperre nach fünf Fehlversuchen; eine Zwei-Faktor-Anmeldung gibt es nicht. Lange, eigene Passwörter für jedes Konto verwenden.
- **Datenschutz:** Gäste- und Rechnungsdaten liegen dann beim Anbieter. Dafür ist ein Vertrag zur Auftragsverarbeitung mit dem
  Anbieter nötig; das wurde nicht rechtlich geprüft.
- **Umzug bestehender Daten** von der Windows-Version: Sicherung dort erstellen (`backups\*.dump`), auf den Server kopieren und
  mit `npm run restore` einspielen. Der Schlüssel für das E-Mail-Passwort (`data\secret.key`) gehört nach `/var/lib/pms`.
  Dieser Umzug ist nicht erprobt.
