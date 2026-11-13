import { useEffect, useMemo, useState } from 'react';
import {
  PAYMENT_METHODS, SOURCES, addDays, bookingCreateInput, diffDays, formatMoney, isIsoDate, parseMoney, todayBerlin,
  type CategoryDto, type FreeRoomDto, type GuestDto, type ServiceDto,
} from '../../../src/shared/hotel.js';
import { api } from '../api.ts';
import { useData, type NewPreset } from '../data.tsx';
import { Button, Dialog, Field, useLoad, useSubmit, useToast } from '../ui.tsx';
import { GuestFields, toDraft, type GuestDraft } from './common.tsx';
import { CompanySelect } from './CompanySelect.tsx';

interface Pick { adults: string; children: string; price: string }

/** Neue Reservierung: Zeitraum → freie Zimmer anhaken → Gast wählen oder eintragen → anlegen. */
export function NewBooking({ preset, onClose }: { preset: NewPreset; onClose: () => void }) {
  const { bump } = useData();
  const toast = useToast();
  const start = preset.from ?? todayBerlin();
  const [from, setFrom] = useState(start);
  const [to, setTo] = useState(preset.to ?? addDays(start, 1));
  const [status, setStatus] = useState<'confirmed' | 'tentative'>('confirmed');
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [guest, setGuest] = useState<GuestDto | null>(preset.guest ?? null);
  const [draft, setDraft] = useState<GuestDraft>(toDraft({}));
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<GuestDto[]>([]);
  const [meta, setMeta] = useState({ source: preset.companyId ? 'Firma' : 'Telefon', paymentMethod: preset.companyId ? 'Rechnung an Firma' : '', groupName: '', notes: '' });
  const [companyId, setCompanyId] = useState(preset.companyId ?? '');
  const [breakfast, setBreakfast] = useState(false);

  const valid = isIsoDate(from) && isIsoDate(to) && from < to;
  const nights = valid ? diffDays(from, to) : 0;
  const free = useLoad(async () => (valid ? api<FreeRoomDto[]>('GET', `/availability?from=${from}&to=${to}${companyId ? `&companyId=${companyId}` : ''}`) : []), [from, to, companyId]);
  const base = useLoad(async () => {
    const [cats, services] = await Promise.all([api<CategoryDto[]>('GET', '/categories'), api<ServiceDto[]>('GET', '/services')]);
    return { cats, breakfast: services.find((s) => s.isBreakfast && s.active) ?? null };
  });
  const std = (r: FreeRoomDto) => String(base.data?.cats.find((c) => c.id === r.categoryId)?.stdOccupancy ?? 2);

  // Auswahl an die freien Zimmer anpassen; Vorauswahl aus dem Belegungsplan übernehmen
  useEffect(() => {
    if (!free.data) return;
    setPicks((cur) => {
      const next: Record<string, Pick> = {};
      for (const r of free.data!) if (cur[r.id]) next[r.id] = cur[r.id]!;
      if (preset.roomId && !Object.keys(cur).length) {
        const r = free.data!.find((x) => x.id === preset.roomId);
        if (r) next[r.id] = { adults: std(r), children: '0', price: '' };
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [free.data, base.data]);

  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(() => { api<GuestDto[]>('GET', '/guests?q=' + encodeURIComponent(q.trim())).then((g) => setHits(g.slice(0, 6))).catch(() => setHits([])); }, 200);
    return () => clearTimeout(t);
  }, [q]);

  const selected = (free.data ?? []).filter((r) => picks[r.id]);
  const total = useMemo(() => selected.reduce((s, r) => {
    const manual = parseMoney(picks[r.id]!.price);
    return s + (Number.isNaN(manual) ? r.quoteCents : manual * nights);
  }, 0), [selected, picks, nights]);

  const f = useSubmit(bookingCreateInput, async (d) => {
    const r = await api<{ number: string }>('POST', '/bookings', d);
    toast(`Reservierung ${r.number} angelegt`);
    bump();
    onClose();
  });
  const submit = (e?: React.FormEvent) => void f.submit({
    ...(guest ? { guestId: guest.id } : draft.lastName.trim() ? { guest: draft } : {}),
    ...meta, breakfast, ...(companyId ? { companyId } : {}),
    rooms: selected.map((r) => {
      const p = picks[r.id]!;
      return { roomId: r.id, from, to, status, adults: Number(p.adults), children: Number(p.children), pricePerNightCents: p.price.trim() === '' ? null : parseMoney(p.price) };
    }),
  }, e);
  const otherErrors = Object.entries(f.errors).filter(([k]) => !k.startsWith('guest.')).map(([, m]) => m);
  const toggle = (r: FreeRoomDto) => setPicks((cur) => {
    const next = { ...cur };
    if (next[r.id]) delete next[r.id]; else next[r.id] = { adults: std(r), children: '0', price: '' };
    return next;
  });
  const setPick = (id: string, patch: Partial<Pick>) => setPicks((cur) => ({ ...cur, [id]: { ...cur[id]!, ...patch } }));

  return (
    <Dialog title="Neue Reservierung" onClose={onClose} size="xl"
      footer={<><span className="left total">{selected.length > 0 && <>{selected.length} Zimmer · {nights} {nights === 1 ? 'Nacht' : 'Nächte'} · <b>{formatMoney(total)}</b> Logis</>}</span>
        <Button onClick={onClose}>Abbrechen</Button><Button variant="primary" busy={f.busy} onClick={() => submit()}>Reservierung anlegen</Button></>}>
      <form onSubmit={submit} noValidate className="split">
        <div>
          <div className="formgrid cols3">
            <Field label="Anreise"><input type="date" value={from} onChange={(e) => { setFrom(e.target.value); if (isIsoDate(e.target.value) && e.target.value >= to) setTo(addDays(e.target.value, 1)); }} /></Field>
            <Field label="Abreise" error={!valid ? 'Muss nach der Anreise liegen' : undefined}><input type="date" value={to} min={isIsoDate(from) ? addDays(from, 1) : undefined} onChange={(e) => setTo(e.target.value)} /></Field>
            <Field label="Status">
              <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
                <option value="confirmed">Bestätigt</option><option value="tentative">Vorläufig</option>
              </select>
            </Field>
          </div>
          <h3>Freie Zimmer{valid && free.data ? ` (${free.data.length})` : ''}</h3>
          {free.error && <p className="notice danger">{free.error}</p>}
          {valid && free.data?.length === 0 && <p className="notice warn">In diesem Zeitraum ist kein Zimmer frei.</p>}
          <div className="roompick">
            {(free.data ?? []).map((r) => {
              const p = picks[r.id];
              return (
                <div key={r.id} className={`pickrow${p ? ' on' : ''}`}>
                  <label className="check">
                    <input type="checkbox" checked={!!p} onChange={() => toggle(r)} />
                    <span><b>Zimmer {r.number}</b> <small className="inl">{r.categoryName}</small></span>
                  </label>
                  {!p && <span className="num muted">{formatMoney(r.quoteCents)}</span>}
                  {p && (
                    <div className="pickedit">
                      <label><small>Erw.</small><input type="number" min={1} value={p.adults} onChange={(e) => setPick(r.id, { adults: e.target.value })} /></label>
                      <label><small>Kinder</small><input type="number" min={0} value={p.children} onChange={(e) => setPick(r.id, { children: e.target.value })} /></label>
                      <label><small>Preis/Nacht</small><input inputMode="decimal" value={p.price} placeholder={(r.quoteCents / nights / 100).toFixed(2).replace('.', ',')} onChange={(e) => setPick(r.id, { price: e.target.value })} /></label>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <p className="muted small">Preis/Nacht leer lassen = Preis nach Preisregeln. Ein eingetragener Betrag gilt als Sonderpreis für alle Nächte.</p>
        </div>
        <aside>
          <h3 className="first">Gast</h3>
          {guest ? (
            <div className="chosen"><span><b>{[guest.firstName, guest.lastName].filter(Boolean).join(' ')}</b><br /><small>{[guest.company, guest.city, guest.email].filter(Boolean).join(' · ') || 'aus der Gästekartei'}</small></span>
              <Button onClick={() => setGuest(null)}>Ändern</Button></div>
          ) : (
            <>
              <input type="search" placeholder="Gast oder Firma suchen …" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Gast suchen" />
              {hits.length > 0 && (
                <div className="hits">
                  {hits.map((g) => (
                    <button type="button" key={g.id} onClick={() => { setGuest(g); setQ(''); setHits([]); }}>
                      <b>{[g.firstName, g.lastName].filter(Boolean).join(' ')}</b> <small>{[g.company, g.city, g.stays ? `${g.stays} Aufenthalte` : ''].filter(Boolean).join(' · ')}</small>
                    </button>
                  ))}
                </div>
              )}
              <p className="muted small">oder neuen Gast eintragen:</p>
              <GuestFields value={draft} onChange={setDraft} errors={f.errors} prefix="guest." compact />
              {f.errors.guest && <p className="error">{f.errors.guest}</p>}
            </>
          )}
          <h3>Angaben</h3>
          <CompanySelect value={companyId} onChange={(cid) => { setCompanyId(cid); if (cid) setMeta({ ...meta, source: 'Firma', paymentMethod: 'Rechnung an Firma' }); }} />
          <div className="formgrid">
            <Field label="Buchungsquelle"><select value={meta.source} onChange={(e) => setMeta({ ...meta, source: e.target.value })}>{SOURCES.map((s) => <option key={s}>{s}</option>)}</select></Field>
            <Field label="Zahlungsart"><select value={meta.paymentMethod} onChange={(e) => setMeta({ ...meta, paymentMethod: e.target.value })}><option value="">offen</option>{PAYMENT_METHODS.map((s) => <option key={s}>{s}</option>)}</select></Field>
            {selected.length > 1 && <Field label="Gruppenname" wide><input value={meta.groupName} onChange={(e) => setMeta({ ...meta, groupName: e.target.value })} placeholder="z. B. Hochzeit Müller" /></Field>}
            {base.data?.breakfast && (
              <label className="check wide"><input type="checkbox" checked={breakfast} onChange={(e) => setBreakfast(e.target.checked)} />
                <span>Mit Frühstück <small className="inl">{formatMoney(base.data.breakfast.priceCents)} pro Person und Nacht</small></span></label>
            )}
            <Field label="Interne Bemerkungen" wide><textarea rows={2} value={meta.notes} onChange={(e) => setMeta({ ...meta, notes: e.target.value })} /></Field>
          </div>
          {otherErrors.length > 0 && <p className="notice danger" role="alert">{[...new Set(otherErrors)].join(' · ')}</p>}
        </aside>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
