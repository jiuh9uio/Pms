import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { hasModule, type Module, type SearchHit, type SearchResult } from '../../src/shared/schemas.js';
import { api } from './api.ts';
import { useAuth } from './App.tsx';
import { useData } from './data.tsx';
import { Dialog } from './ui.tsx';

interface Page { to: string; title: string; area: string; words: string; module?: Module; admin?: boolean }
/** Seiten und Reiter des Programms mit Stichwörtern, unter denen man sie sucht. */
const PAGES: Page[] = [
  { to: '/hotel', title: 'Übersicht', area: 'Hotel', words: 'dashboard anreisen abreisen auslastung aufgaben heute', module: 'hotel' },
  { to: '/plan', title: 'Belegungsplan', area: 'Hotel', words: 'kalender zimmerplan sperren belegung', module: 'hotel' },
  { to: '/reservierungen', title: 'Reservierungen', area: 'Hotel', words: 'buchung buchungen check-in check-out stornieren meldeschein', module: 'hotel' },
  { to: '/fruehstueck', title: 'Frühstück', area: 'Hotel', words: 'frühstücksliste küche bon', module: 'hotel' },
  { to: '/gaeste', title: 'Gäste', area: 'Hotel', words: 'gästekartei kundenkartei gast adresse datenschutz', module: 'hotel' },
  { to: '/firmen', title: 'Firmen', area: 'Hotel', words: 'firmenkunden firmenpreis', module: 'hotel' },
  { to: '/rechnungen', title: 'Rechnungen', area: 'Hotel', words: 'rechnung storno zahlung offene posten export csv mahnung zahlungserinnerung', module: 'hotel' },
  { to: '/auswertung', title: 'Auswertung', area: 'Hotel', words: 'statistik umsatz auslastung monat jahr', module: 'hotel' },
  { to: '/zimmer?ansicht=kategorien', title: 'Zimmerkategorien und Preise', area: 'Hotel · Zimmer & Preise', words: 'kategorie grundpreis einzelbelegung aufpreis kinder', module: 'hotel', admin: true },
  { to: '/zimmer?ansicht=zimmer', title: 'Zimmer anlegen und ändern', area: 'Hotel · Zimmer & Preise', words: 'zimmernummer etage', module: 'hotel', admin: true },
  { to: '/zimmer?ansicht=regeln', title: 'Preisregeln', area: 'Hotel · Zimmer & Preise', words: 'saison wochenende aktion preis', module: 'hotel', admin: true },
  { to: '/zimmer?ansicht=leistungen', title: 'Frühstück und Zusatzleistungen', area: 'Hotel · Zimmer & Preise', words: 'leistung parkplatz haustier frühstückspreis', module: 'hotel', admin: true },
  { to: '/restaurant', title: 'Tischreservierungen', area: 'Restaurant', words: 'tisch tische reservieren restaurant', module: 'restaurant' },
  { to: '/schnelldruck', title: 'Schnelldruck', area: 'Schnelldruck', words: 'zettel bon drucken öffnungszeiten wlan google bewertung rezension taxi rufnummern info aufenthalt website', module: 'schnelldruck' },
  { to: '/kontrollen', title: 'Kontrollen', area: 'Kontrollen', words: 'hygieneamt finanzamt temperatur temperaturprotokoll kühltruhe reinigung reinigungsprotokoll wareneingang unterlagen zonen bereiche messstellen', module: 'kontrollen' },
  { to: '/erechnung', title: 'E-Rechnung', area: 'E-Rechnung', words: 'zugferd xrechnung pdf umwandeln versenden', module: 'erechnung' },
  { to: '/internet?ansicht=verbindung', title: 'Internetverbindung und Ausfälle', area: 'Internet', words: 'online ausfall ausfallprotokoll störung', module: 'internet' },
  { to: '/internet?ansicht=wlan', title: 'Gäste-WLAN', area: 'Internet', words: 'wlan wifi passwort qr aushang', module: 'internet' },
  { to: '/internet?ansicht=geraete', title: 'Geräte im Netz', area: 'Internet', words: 'netzwerk router ip mac drucker geräte', module: 'internet' },
  { to: '/benutzer', title: 'Benutzer', area: 'Verwaltung', words: 'benutzername passwort zurücksetzen freigaben bereiche rolle mitarbeiter', admin: true },
  { to: '/protokoll', title: 'Änderungsprotokoll', area: 'Verwaltung', words: 'protokoll audit wer hat was geändert', admin: true },
  { to: '/einstellungen?ansicht=haus', title: 'Angaben zum Haus', area: 'Einstellungen', words: 'name adresse telefon öffnungszeiten frühstückszeiten check-in check-out steuernummer iban bank rechnungsnummer zahlungsziel fußtext', admin: true },
  { to: '/einstellungen?ansicht=email', title: 'E-Mail-Versand', area: 'Einstellungen', words: 'gmx smtp postfach mail', admin: true },
  { to: '/einstellungen?ansicht=drucker', title: 'Drucker', area: 'Einstellungen', words: 'epson küchendrucker bondrucker ip-adresse testdruck automatisch frühstücksliste', admin: true },
  { to: '/einstellungen?ansicht=ecgeraet', title: 'EC-Gerät', area: 'Einstellungen', words: 'kartenzahlung kartenterminal vr payment zvt terminal karte', admin: true },
  { to: '/einstellungen?ansicht=loeschen', title: 'Hotel-Daten löschen', area: 'Einstellungen', words: 'löschen aufräumen probedaten testdaten rechnungen buchungen zurücksetzen leeren', admin: true },
  { to: '/einstellungen?ansicht=algorithmen', title: 'Algorithmen (Frühstücksregeln)', area: 'Einstellungen', words: 'algorithmus regel frühstück etage personen mindestens weniger automatisch', admin: true },
  { to: '/einstellungen?ansicht=tse', title: 'TSE', area: 'Einstellungen', words: 'tse epson stick kassensicherung selbsttest zertifikat seriennummer finanzamt', admin: true },
  { to: '/einstellungen?ansicht=steuern', title: 'Steuersätze', area: 'Einstellungen', words: 'mehrwertsteuer umsatzsteuer mwst 7 19', admin: true },
  { to: '/einstellungen?ansicht=netz', title: 'Zugriff im Hausnetz', area: 'Einstellungen', words: 'tablet adresse firewall netzwerk', admin: true },
  { to: '/einstellungen?ansicht=sicherung', title: 'Datensicherung', area: 'Einstellungen', words: 'backup sichern sicherung wiederherstellen', admin: true },
  { to: '/einstellungen?ansicht=update', title: 'Programm-Update', area: 'Einstellungen', words: 'version aktualisieren update was ist neu änderungen neuigkeiten', admin: true },
  { to: '/konto', title: 'Mein Konto', area: 'Verwaltung', words: 'eigenes passwort ändern darstellung dunkel hell', admin: true },
];
const KIND: Record<SearchHit['kind'], string> = { guest: 'Gast', booking: 'Reservierung', invoice: 'Rechnung', company: 'Firma', table: 'Tischreservierung' };
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Suche über Seiten, Einstellungen, Gäste, Reservierungen, Rechnungen, Firmen und Tischreservierungen. Öffnen auch mit Strg+K. */
export function Search({ variant }: { variant: 'nav' | 'big' }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(true); } };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  return (
    <>
      {variant === 'big'
        ? <button type="button" className="searchbig" onClick={() => setOpen(true)}><span aria-hidden>⌕</span> Suchen: Gast, Reservierung, Rechnung, Einstellung … <kbd>Strg K</kbd></button>
        : <button type="button" className="navsearch" onClick={() => setOpen(true)}><span className="ico" aria-hidden>⌕</span><span className="full">Suche</span><span className="short">Suche</span></button>}
      {open && <SearchDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function SearchDialog({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const data = useData();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [state, setState] = useState<'idle' | 'busy' | 'error'>('idle');
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);

  const term = q.trim();
  const pages = useMemo(() => {
    if (term.length < 2) return [];
    const words = norm(term).split(/\s+/);
    return PAGES.filter((p) => (!p.admin || user.role === 'admin') && (!p.module || hasModule(user, p.module)))
      .filter((p) => words.every((w) => norm(`${p.title} ${p.area} ${p.words}`).includes(w))).slice(0, 8);
  }, [term, user]);

  useEffect(() => {
    if (term.length < 2) { setHits([]); setState('idle'); return; }
    let live = true;
    setState('busy');
    const t = setTimeout(() => {
      api<SearchResult>('GET', '/search?q=' + encodeURIComponent(term))
        .then((r) => { if (live) { setHits(r.hits); setState('idle'); } })
        .catch(() => { if (live) { setHits([]); setState('error'); } });
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [term]);
  useEffect(() => setSel(0), [term, hits.length]);

  const items: { key: string; label: string; title: string; sub: string; go: () => void }[] = [
    ...pages.map((p) => ({ key: p.to, label: p.area, title: p.title, sub: '', go: () => navigate(p.to) })),
    ...hits.map((h) => ({
      key: `${h.kind}-${h.id}-${h.title}`, label: KIND[h.kind], title: h.title, sub: h.sub,
      go: () => {
        if (h.kind === 'guest') data.openGuest(h.id);
        else if (h.kind === 'booking') data.openBooking(h.id);
        else if (h.kind === 'invoice') data.openInvoice(h.id);
        else if (h.kind === 'company') data.openCompany(h.id);
        else navigate(`/restaurant?datum=${h.id}`);
      },
    })),
  ];
  const choose = (i: number) => { const it = items[i]; if (it) { onClose(); it.go(); } };
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(sel); }
  };
  return (
    <Dialog title="Suche" onClose={onClose} size="lg">
      <input ref={input} className="searchinput" type="search" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={keys}
        placeholder="Name, Reservierungs- oder Rechnungsnummer, Seite oder Einstellung …" aria-label="Suchbegriff" autoComplete="off" />
      {term.length < 2 ? <p className="muted">Mindestens zwei Zeichen eingeben. Gefunden werden Seiten und Einstellungen des Programms sowie Gäste, Reservierungen, Rechnungen, Firmen und Tischreservierungen – jeweils nur in den Bereichen, die für Sie freigegeben sind.</p>
        : items.length === 0 ? <p className="muted">{state === 'busy' ? 'Sucht …' : state === 'error' ? 'Die Suche ist gerade nicht erreichbar.' : `Nichts gefunden für „${term}“.`}</p> : (
          <ul className="searchlist" role="listbox">
            {items.map((it, i) => (
              <li key={it.key} role="option" aria-selected={i === sel}>
                <button type="button" className={i === sel ? 'on' : ''} onMouseEnter={() => setSel(i)} onClick={() => choose(i)}>
                  <small>{it.label}</small><span><b>{it.title}</b>{it.sub && <em>{it.sub}</em>}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
    </Dialog>
  );
}
