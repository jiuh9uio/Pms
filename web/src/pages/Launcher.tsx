import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useNotices } from '../notices.ts';
import { HygienePrompt } from './HygienePrompt.tsx';
import { ROLE_LABEL, hasModule, type Module, type OverviewItem } from '../../../src/shared/schemas.js';
import { useAuth, useLogout } from '../App.tsx';
import { api } from '../api.ts';
import { Search } from '../Search.tsx';
import { useLoad } from '../ui.tsx';
import { backupWarning, type BackupStatus } from './BackupCard.tsx';
import type { UpdateStatus } from './UpdateCard.tsx';
import { Icon } from '../icons.tsx';

interface Tile { to: string; title: string; text: string; icon: string; admin?: boolean; /** nötige Freigabe; mehrere = eine davon genügt */ module?: Module | Module[]; /** Ziel, wenn die erste Freigabe fehlt */ alt?: string; group: 'tag' | 'buero' | 'haus' }
const GROUPS: [Tile['group'], string][] = [['tag', 'Tagesgeschäft'], ['buero', 'Büro'], ['haus', 'Haus & Technik']];
const TILES: Tile[] = [
  { group: 'tag', to: '/hotel', title: 'Hotel', text: 'Übersicht, Belegungsplan, Reservierungen, Gäste, Frühstück, Reinigung', icon: '▦', module: 'hotel' },
  { group: 'tag', to: '/restaurant', title: 'Restaurant', text: 'Tischreservierungen je Tag, Tische verwalten', icon: '◍', module: 'restaurant' },
  { group: 'tag', to: '/email', title: 'E-Mail', text: 'Geschäftspostfach lesen, Zimmer- und Tischanfragen übernehmen und beantworten', icon: '✉', module: 'email' },
  { group: 'tag', to: '/team', title: 'Team', text: 'Übergabebuch, Aufgaben und Reparaturen für alle Schichten', icon: '✎' },
  { group: 'buero', to: '/rechnungen', alt: '/erechnung', title: 'Rechnungen', text: 'Hotelrechnungen, Tagesabschluss, E-Rechnung und Archiv', icon: '€', module: ['hotel', 'erechnung'] },
  { group: 'buero', to: '/auswertung', title: 'Auswertung', text: 'Belegungsvorschau, Jahresvergleich, Herkunft der Gäste, Buchungsquellen', icon: '◔', module: 'hotel' },
  { group: 'buero', to: '/gutscheine', title: 'Gutscheine', text: 'Gutscheinbuch mit Kassennummer, eigenes Motiv, E-Mail und Rechnung', icon: 'gift', module: ['hotel', 'restaurant'] },
  { group: 'buero', to: '/einkauf', title: 'Einkauf', text: 'Warenzugang und Leergut-Rückgabe mit Bon', icon: 'cart', module: 'schnelldruck' },
  { group: 'buero', to: '/kontrollen', title: 'Kontrollen', text: 'Hygieneamt, Finanzamt und weitere: Unterlagen, Temperaturprotokolle, Besuche', icon: '✓', module: 'kontrollen' },
  { group: 'haus', to: '/internet', title: 'Internet', text: 'Verbindung, Gäste-WLAN, Geräte im Hausnetz', icon: '⌁', module: 'internet' },
  { group: 'haus', to: '/schnelldruck', title: 'Schnelldruck', text: 'Öffnungszeiten, WLAN und Info-Zettel aus dem Bondrucker', icon: '⎙', module: 'schnelldruck' },
  { group: 'haus', to: '/einstellungen', title: 'Verwaltung', text: 'Einstellungen, Benutzer, Änderungsprotokoll', icon: '⚙', admin: true },
  { group: 'haus', to: '/konto', title: 'Mein Konto', text: 'Passwort, Zwei-Faktor-Anmeldung, Darstellung', icon: '◐' },
];
const allowed = (user: Parameters<typeof hasModule>[0], m: Tile['module']) => !m || (Array.isArray(m) ? m.some((x) => hasModule(user, x)) : hasModule(user, m));

/** Startmenü nach der Anmeldung: von hier geht es in die einzelnen Bereiche. */
export function Launcher() {
  const { user } = useAuth();
  const logout = useLogout();
  // Hinweis auf ein neues Programm-Update – nur für Administratoren
  const upd = useLoad(() => (user.role === 'admin' ? api<UpdateStatus>('GET', '/update/status') : Promise.resolve(null))).data;
  const bak = useLoad(() => (user.role === 'admin' ? api<BackupStatus>('GET', '/backup/status') : Promise.resolve(null))).data;
  const bakWarn = bak ? backupWarning(bak) : null;
  // „Heute im Haus“ ist von Haus aus ausgeblendet; die Wahl merkt sich dieser Browser
  const [showToday, setShowToday] = useState(() => { try { return localStorage.getItem('pms.heute') === 'an'; } catch { return false; } });
  const toggleToday = () => { const next = !showToday; setShowToday(next); try { localStorage.setItem('pms.heute', next ? 'an' : 'aus'); } catch { /* ohne Speicher gilt die Wahl bis zum Neuladen */ } };
  const today = useLoad(() => (showToday ? api<OverviewItem[]>('GET', '/overview') : Promise.resolve(null)), [showToday]).data;
  // Logo des Hauses, falls hinterlegt (nur mit Freigabe für den Bereich Hotel abrufbar)
  const [logo, setLogo] = useState(false);
  useEffect(() => { if (hasModule(user, 'hotel')) api<{ present: boolean }>('GET', '/settings/logo-info').then((r) => setLogo(r.present)).catch(() => setLogo(false)); }, [user]);
  // offene Anfragen im E-Mail-Posteingang als Zähler an der Kachel
  const mailNew = useLoad(() => (hasModule(user, 'email') ? api<{ newCount: number; ready: boolean }>('GET', '/inbox/state') : Promise.resolve(null))).data;
  // Start-Checkliste: Hinweis für den Administrator, solange Grundlagen fehlen
  const setup = useLoad(() => (user.role === 'admin' ? api<{ ready: boolean; open: number }>('GET', '/setup/checklist') : Promise.resolve(null))).data;
  const notices = useNotices();
  const teamNew = useLoad(() => api<{ unread: number; openTasks: number }>('GET', '/team/state')).data;
  const tiles = TILES.filter((t) => (!t.admin || user.role === 'admin') && allowed(user, t.module))
    .map((t) => (t.alt && Array.isArray(t.module) && !hasModule(user, t.module[0]!) ? { ...t, to: t.alt } : t));
  return (
    <div className="launcher">
      <header>
        <div className="brand big">{logo ? <img className="brandlogo" src="/api/v1/settings/logo" alt="" /> : <span className="mark">S</span>}<span>Schützenhaus<small>Hotel &amp; Restaurant</small></span></div>
        <p className="muted">{user.name} · {ROLE_LABEL[user.role]} <button type="button" className="btn" onClick={() => void logout()}>Abmelden</button> <Link className="small" to="/als-programm">Als Programm öffnen (Symbol einrichten)</Link></p>
      </header>
      <Search variant="big" />
      {notices?.updateHint && upd?.available && <p className="notice warn">Programm-Update verfügbar: Version {upd.latest}. <Link to="/einstellungen?ansicht=update">Jetzt ansehen und einspielen</Link></p>}
      {notices?.setupHint && setup && !setup.ready && <p className="notice warn">Vor dem Start {setup.open === 1 ? 'fehlt noch ein Punkt' : `fehlen noch ${setup.open} Punkte`} bei der Einrichtung. <Link to="/erste-schritte">Zur Checkliste „Erste Schritte“</Link></p>}
      {notices?.backupWarn && bakWarn && <p className="notice danger">{bakWarn} <Link to="/einstellungen?ansicht=sicherung">Zur Datensicherung</Link></p>}
      <p className="todaytoggle"><button type="button" className="linkbtn" aria-expanded={showToday} onClick={toggleToday}>{showToday ? 'Heute im Haus ausblenden' : 'Heute im Haus anzeigen'}</button></p>
      {showToday && today && today.length > 0 && (
        <section className="todaystrip" aria-label="Heute im Haus">
          {today.map((t) => (
            <Link key={t.key} to={t.to} className={`todayitem ${t.tone}`}><span>{t.label}</span><b>{t.value}</b><small>{t.sub}</small></Link>
          ))}
        </section>
      )}
      {GROUPS.map(([g, label]) => {
        const list = tiles.filter((t) => t.group === g);
        if (!list.length) return null;
        return (
          <section key={g} className={`tilegroup ${g}`}>
            <h2 className="tilegroup-title">{label}</h2>
            <nav className="tiles" aria-label={label}>
              {list.map((t) => (
                <Link key={t.to} to={t.to} className="tile">
                  <span className="tile-icon" aria-hidden><Icon g={t.icon} /></span>
                  <span className="tile-body">
                    <span className="tile-title">{t.title}{t.to === '/email' && notices?.mailCount && mailNew && mailNew.newCount > 0 && <span className="tile-count" aria-label={`${mailNew.newCount} offen`}>{mailNew.newCount}</span>}{t.to === '/team' && notices?.teamCount && teamNew && teamNew.unread > 0 && <span className="tile-count" aria-label={`${teamNew.unread} ungelesen`}>{teamNew.unread}</span>}</span>
                    <span className="tile-text">{t.text}</span>
                  </span>
                </Link>
              ))}
            </nav>
          </section>
        );
      })}
      {notices && (notices.hygieneTemp || notices.hygieneClean) && hasModule(user, 'kontrollen') && <HygienePrompt temp={notices.hygieneTemp} clean={notices.hygieneClean} />}
      {tiles.length === 0 && <p className="notice">Für dieses Konto ist noch kein Bereich freigegeben. Bitte den Administrator ansprechen.</p>}
    </div>
  );
}
