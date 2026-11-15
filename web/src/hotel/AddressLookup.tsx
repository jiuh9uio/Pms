import { useState } from 'react';
import { api } from '../api.ts';
import { Button } from '../ui.tsx';

export type Found = { name: string; street: string; zip: string; city: string; country: string; phone: string; email: string; vatId: string; source: string; label?: string };
type Kind = 'imprint' | 'map' | 'maps';
const MAPS = /^(https?:\/\/)?((www\.|maps\.)?google\.[a-z.]{2,6}\/maps|maps\.google\.[a-z.]{2,6}|maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs)/i;
const SITE = /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i;

/**
 * Adressdaten nachschlagen – nur auf Knopfdruck: Google-Maps-Link einfügen, Impressum einer Website lesen
 * oder über die Karte (OpenStreetMap) nach Name und Ort suchen.
 */
export function AddressLookup({ onPick, forGuest, onClose }: { onPick: (c: Found) => void; forGuest?: boolean; onClose?: () => void }) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<'' | Kind>('');
  const [hits, setHits] = useState<Found[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const t = q.trim();
  const isMaps = MAPS.test(t), isSite = !isMaps && SITE.test(t);
  const auto: Kind = isMaps ? 'maps' : isSite ? 'imprint' : 'map';
  const run = async (kind: Kind) => {
    if (t.length < 3) return;
    setBusy(kind); setNote(null); setHits(null);
    try {
      if (kind === 'imprint') {
        const r = await api<{ found: Found; page: string }>('POST', '/companies/lookup/imprint', { url: t });
        setHits([r.found]); setNote(`Gelesen von ${r.page}`);
      } else if (kind === 'maps') {
        const r = await api<Found[]>('POST', '/companies/lookup/maps', { url: /^https?:\/\//i.test(t) ? t : `https://${t}` });
        setHits(r); setNote(r[0]?.source === 'Google-Maps-Link' ? 'Aus dem Google-Maps-Link gelesen.' : 'Im Link stand keine vollständige Anschrift – Vorschläge von OpenStreetMap.');
      } else {
        const r = await api<Found[]>('GET', `/companies/lookup/search?q=${encodeURIComponent(t)}`);
        setHits(r); if (!r.length) setNote('Kein Treffer mit vollständiger Anschrift. Versuchen Sie es mit Name und Ort.');
      }
    } catch (e) { setNote(e instanceof Error ? e.message : 'Das hat nicht geklappt.'); }
    setBusy('');
  };
  return (
    <div className="lookup wide">
      <div className="lookuphead">
        <h3 className="first">Adresse nachschlagen</h3>
        {onClose && <button type="button" className="linkbtn" onClick={onClose}>Schließen</button>}
      </div>
      <div className="lookuprow">
        <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Google-Maps-Link, Website oder Name und Ort"
          placeholder={forGuest ? 'Google-Maps-Link, Website (Impressum) oder Firma/Straße und Ort' : 'Google-Maps-Link, Website (www.firma.de) oder Firmenname und Ort'}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void run(auto); } }} />
        {isMaps
          ? <Button variant="primary" busy={busy === 'maps'} disabled={busy !== ''} onClick={() => void run('maps')}>Maps-Link auslesen</Button>
          : <>
              <Button busy={busy === 'imprint'} disabled={busy !== '' || !isSite} onClick={() => void run('imprint')}>Impressum lesen</Button>
              <Button busy={busy === 'map'} disabled={busy !== '' || t.length < 3 || isSite} onClick={() => void run('map')}>Auf der Karte suchen</Button>
            </>}
      </div>
      {note && <p className="muted small">{note}</p>}
      {hits?.map((h, i) => (
        <div key={i} className="lookuphit">
          <div><b>{h.name || '(ohne Namen)'}</b><br /><small>{[h.street, [h.zip, h.city].filter(Boolean).join(' '), h.country].filter(Boolean).join(', ')}{!forGuest && <>{h.phone && ` · ${h.phone}`}{h.email && ` · ${h.email}`}{h.vatId && ` · ${h.vatId}`}</>}</small></div>
          <Button variant="primary" onClick={() => { onPick(h); setHits(null); setNote('Übernommen – bitte prüfen und speichern.'); }}>Übernehmen</Button>
        </div>
      ))}
      <p className="muted small">
        Google Maps: in der App oder im Browser beim Ort auf „Teilen“ → „Link kopieren“ und hier einfügen. Der Link wird nur ausgelesen; bei Kurzlinks (maps.app.goo.gl) wird dafür einmal die Weiterleitung bei Google abgerufen.
        {' '}Bei Website und Kartensuche geht der eingegebene Begriff an die Website bzw. an OpenStreetMap.
        {forGuest ? ' Übernommen werden nur Straße, PLZ, Ort und Land (bei leerem Feld auch die Firma).' : ' Übernommen werden nur gefundene Angaben; vorhandene Einträge bleiben, wo nichts gefunden wurde.'}
      </p>
    </div>
  );
}
