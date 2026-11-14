import { useEffect, useState } from 'react';
import { companyInput, formatMoney, moneyInput, parseMoney, type BookingListRow, type CategoryDto, type CompanyDto } from '../../../src/shared/hotel.js';
import { api } from '../api.ts';
import { useData } from '../data.tsx';
import { Button, Dialog, Field, LoadState, useLoad, useSubmit, useToast } from '../ui.tsx';
import { StatusBadge, deDate } from './common.tsx';

type Draft = { name: string; street: string; zip: string; city: string; country: string; vatId: string; contactName: string; email: string; phone: string; term: string; notes: string; active: boolean };

/** Firmenprofil: Rechnungsanschrift, Ansprechpartner, vereinbarte Preise, Zahlungsziel, Buchungshistorie. */
export function CompanyDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { rev, bump, newBooking, openBooking } = useData();
  const toast = useToast();
  const { data, error } = useLoad(async () => {
    const cats = await api<CategoryDto[]>('GET', '/categories');
    const detail = id ? await api<{ company: CompanyDto; bookings: BookingListRow[] }>('GET', `/companies/${id}`) : null;
    return { cats, detail };
  }, [id, rev]);
  const [v, setV] = useState<Draft | null>(null);
  const [rates, setRates] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!data) return;
    const c = data.detail?.company;
    setV({ name: c?.name ?? '', street: c?.street ?? '', zip: c?.zip ?? '', city: c?.city ?? '', country: c?.country ?? 'Deutschland', vatId: c?.vatId ?? '',
      contactName: c?.contactName ?? '', email: c?.email ?? '', phone: c?.phone ?? '', term: c?.paymentTermDays == null ? '' : String(c.paymentTermDays), notes: c?.notes ?? '', active: c?.active ?? true });
    setRates(Object.fromEntries((c?.rates ?? []).map((r) => [r.categoryId, moneyInput(r.priceCents)])));
  }, [data]);
  const f = useSubmit(companyInput, async (d) => {
    await api(id ? 'PUT' : 'POST', id ? `/companies/${id}` : '/companies', id ? { ...d, version: data!.detail!.company.version } : d);
    toast('Firma gespeichert');
    bump();
    if (!id) onClose();
  });
  if (!data || !v) return <Dialog title="Firma" onClose={onClose}><LoadState error={error} loading /></Dialog>;
  const send = (e?: React.FormEvent) => {
    const { term, ...rest } = v;
    void f.submit({
      ...rest, paymentTermDays: term.trim() === '' ? null : Number(term),
      rates: Object.entries(rates).filter(([, p]) => p.trim() !== '').map(([categoryId, p]) => ({ categoryId, priceCents: parseMoney(p) })),
    }, e);
  };
  const input = (k: keyof Draft, label: string, o: { wide?: boolean; hint?: string; type?: string } = {}) => (
    <Field label={label} error={f.errors[k === 'term' ? 'paymentTermDays' : k]} wide={o.wide} hint={o.hint}>
      <input type={o.type ?? 'text'} value={v[k] as string} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
    </Field>
  );
  const c = data.detail?.company;
  return (
    <Dialog title={c ? c.name : 'Neue Firma'} onClose={onClose} size={id ? 'xl' : 'lg'}
      footer={<>{c && <Button className="left" onClick={() => { onClose(); newBooking({ companyId: c.id }); }}>Neue Reservierung für diese Firma</Button>}
        <Button onClick={onClose}>Schließen</Button><Button variant="primary" busy={f.busy} onClick={() => send()}>Speichern</Button></>}>
      <div className={id ? 'split' : ''}>
        <form onSubmit={send} noValidate>
          <AddressLookup onPick={(c) => setV({ ...v, name: c.name || v.name, street: c.street || v.street, zip: c.zip || v.zip, city: c.city || v.city, country: c.country || v.country,
            vatId: c.vatId || v.vatId, phone: c.phone || v.phone, email: c.email || v.email })} />
          <h3 className="first">Rechnungsanschrift</h3>
          <div className="formgrid">
            {input('name', 'Firmenname', { wide: true })}{input('street', 'Straße und Hausnummer', { wide: true })}{input('zip', 'PLZ')}{input('city', 'Ort')}
            {input('country', 'Land')}{input('vatId', 'USt-IdNr.')}
            {input('contactName', 'Ansprechpartner', { hint: 'erscheint auf der Rechnung als „z. Hd.“' })}{input('email', 'E-Mail für Rechnungen', { type: 'email' })}
            {input('phone', 'Telefon')}{input('term', 'Zahlungsziel in Tagen', { hint: 'leer = Standard aus den Einstellungen' })}
          </div>
          <h3>Vereinbarte Preise je Nacht</h3>
          <p className="muted small">Leer = normaler Preis mit Saison- und Wochenendregeln. Ein eingetragener Preis gilt für alle Nächte von Firmenbuchungen dieser Kategorie.</p>
          <div className="formgrid">
            {data.cats.map((cat) => (
              <Field key={cat.id} label={cat.name} hint={`normal ab ${formatMoney(cat.basePriceCents)}`}>
                <input inputMode="decimal" value={rates[cat.id] ?? ''} placeholder="normal" onChange={(e) => setRates({ ...rates, [cat.id]: e.target.value })} />
              </Field>
            ))}
          </div>
          <div className="formgrid">
            <Field label="Interne Bemerkungen" wide error={f.errors.notes}><textarea rows={2} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
            {id && <label className="check wide"><input type="checkbox" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} /><span>Aktiv <small>Inaktive Firmen stehen bei neuen Buchungen nicht zur Auswahl.</small></span></label>}
          </div>
          {f.errors.rates && <p className="error">{f.errors.rates}</p>}
          <button type="submit" hidden />
        </form>
        {data.detail && (
          <aside>
            <h3 className="first">Überblick</h3>
            <table className="sums"><tbody>
              <tr><td>Reservierungen</td><td className="num">{data.detail.company.bookingCount}</td></tr>
              <tr><td>Berechnet (Rechnungen)</td><td className="num">{formatMoney(data.detail.company.revenueCents)}</td></tr>
              <tr><td>Letzter Aufenthalt</td><td className="num">{deDate(data.detail.company.lastStay)}</td></tr>
            </tbody></table>
            <h3>Buchungshistorie</h3>
            {data.detail.bookings.length === 0 && <p className="muted">Noch keine Reservierungen.</p>}
            <ul className="plain compact">
              {data.detail.bookings.map((b) => (
                <li key={b.id} className="rowlink" onClick={() => openBooking(b.bookingId)}>
                  <span>{deDate(b.from)} – {deDate(b.to)}<br /><small>{b.guestName} · Zimmer {b.roomNumber} · {b.number}</small></span>
                  <span className="right"><StatusBadge status={b.status} /><br /><small>{formatMoney(b.lodgingCents)}</small></span>
                </li>
              ))}
            </ul>
          </aside>
        )}
      </div>
    </Dialog>
  );
}

type Found = { name: string; street: string; zip: string; city: string; country: string; phone: string; email: string; vatId: string; source: string; label?: string };
/** Adressdaten nachschlagen: Impressum einer Website lesen oder über die Karte (OpenStreetMap) suchen. Nur auf Knopfdruck. */
function AddressLookup({ onPick }: { onPick: (c: Found) => void }) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<'' | 'imprint' | 'map'>('');
  const [hits, setHits] = useState<Found[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const looksLikeSite = /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(q.trim());
  const run = async (kind: 'imprint' | 'map') => {
    if (q.trim().length < 3) return;
    setBusy(kind); setNote(null); setHits(null);
    try {
      if (kind === 'imprint') {
        const r = await api<{ found: Found; page: string }>('POST', '/companies/lookup/imprint', { url: q.trim() });
        setHits([r.found]); setNote(`Gelesen von ${r.page}`);
      } else {
        const r = await api<Found[]>('GET', `/companies/lookup/search?q=${encodeURIComponent(q.trim())}`);
        setHits(r); if (!r.length) setNote('Kein Treffer mit vollständiger Anschrift. Versuchen Sie es mit Firmenname und Ort.');
      }
    } catch (e) { setNote(e instanceof Error ? e.message : 'Das hat nicht geklappt.'); }
    setBusy('');
  };
  return (
    <div className="lookup">
      <h3 className="first">Adresse nachschlagen</h3>
      <div className="lookuprow">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Website (www.firma.de) oder Firmenname und Ort" aria-label="Website oder Firmenname"
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void run(looksLikeSite ? 'imprint' : 'map'); } }} />
        <Button busy={busy === 'imprint'} disabled={busy !== '' || !looksLikeSite} onClick={() => void run('imprint')}>Impressum lesen</Button>
        <Button busy={busy === 'map'} disabled={busy !== '' || q.trim().length < 3 || looksLikeSite} onClick={() => void run('map')}>Auf der Karte suchen</Button>
      </div>
      {note && <p className="muted small">{note}</p>}
      {hits?.map((h, i) => (
        <div key={i} className="lookuphit">
          <div><b>{h.name || '(ohne Namen)'}</b><br /><small>{[h.street, [h.zip, h.city].filter(Boolean).join(' '), h.country].filter(Boolean).join(', ')}{h.phone && ` · ${h.phone}`}{h.email && ` · ${h.email}`}{h.vatId && ` · ${h.vatId}`}</small></div>
          <Button variant="primary" onClick={() => { onPick(h); setHits(null); setNote('Übernommen – bitte prüfen und speichern.'); }}>Übernehmen</Button>
        </div>
      ))}
      <p className="muted small">Der eingegebene Begriff geht dabei an die genannte Website bzw. an die Ortssuche von OpenStreetMap. Übernommen werden nur gefundene Angaben; vorhandene Einträge bleiben, wo nichts gefunden wurde.</p>
    </div>
  );
}
