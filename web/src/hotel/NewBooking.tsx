import { useEffect, useMemo, useState } from 'react';
import {
  PAYMENT_METHODS, SOURCES, addDays, bookingCreateInput, diffDays, formatMoney, isIsoDate, parseMoney, personAdjust, todayBerlin,
  type CategoryDto, type FreeRoomDto, type GuestDto, type RoomDto, type ServiceDto,
} from '../../../src/shared/hotel.js';
import type { HotelSettings } from '../../../src/shared/schemas.js';
import { api } from '../api.ts';
import { useData, type NewPreset } from '../data.tsx';
import { Button, Dialog, Field, useLoad, useSubmit, useToast } from '../ui.tsx';
import { GuestFields, deDate, toDraft, type GuestDraft } from './common.tsx';
import { CompanySelect } from './CompanySelect.tsx';
import { catColorIndex, groupByFloor } from './roomgroups.ts';

interface Pick { adults: string; children: string; price: string }

/**
 * Neue Reservierung: Zeitraum → freies Zimmer antippen (nach Etage, Farbe je Kategorie) → Gast wählen oder eintragen →
 * „Als Anfrage anlegen“ (vorläufig, Zimmer wird bis „Option bis“ freigehalten) oder „Fest buchen“ (bestätigt).
 */
export function NewBooking({ preset, onClose }: { preset: NewPreset; onClose: () => void }) {
  const { bump } = useData();
  const toast = useToast();
  const start = preset.from ?? todayBerlin();
  const [from, setFrom] = useState(start);
  const [to, setTo] = useState(preset.to ?? addDays(start, 1));
  // leer = automatisch: heute + Tage aus den Einstellungen, höchstens bis zur Anreise
  const [optionUntil, setOptionUntil] = useState('');
  const [sending, setSending] = useState<'confirmed' | 'tentative' | null>(null);
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [guest, setGuest] = useState<GuestDto | null>(preset.guest ?? null);
  const [draft, setDraft] = useState<GuestDraft>(toDraft(preset.draft ?? {}));
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<GuestDto[]>([]);
  const [meta, setMeta] = useState({ source: preset.source ?? (preset.companyId ? 'Firma' : 'Telefon'), paymentMethod: preset.companyId ? 'Rechnung an Firma' : '', groupName: '', notes: preset.notes ?? '' });
  const [companyId, setCompanyId] = useState(preset.companyId ?? '');
  const [breakfast, setBreakfast] = useState(false);
  const [dropped, setDropped] = useState<string[]>([]);

  const valid = isIsoDate(from) && isIsoDate(to) && from < to;
  const nights = valid ? diffDays(from, to) : 0;
  const free = useLoad(async () => (valid ? api<FreeRoomDto[]>('GET', `/availability?from=${from}&to=${to}${companyId ? `&companyId=${companyId}` : ''}`) : []), [from, to, companyId]);
  const base = useLoad(async () => {
    const [cats, services, rooms] = await Promise.all([api<CategoryDto[]>('GET', '/categories'), api<ServiceDto[]>('GET', '/services'), api<RoomDto[]>('GET', '/rooms')]);
    return { cats, breakfast: services.find((s) => s.isBreakfast && s.active) ?? null, rooms: rooms.filter((r) => r.active) };
  });
  const hotel = useLoad(() => api<HotelSettings>('GET', '/settings/hotel'));
  const today = todayBerlin();
  const autoOption = (() => {
    const d = addDays(today, hotel.data?.requestOptionDays ?? 3);
    return isIsoDate(from) && from < d ? (from < today ? today : from) : d;
  })();
  const option = optionUntil || autoOption;
  const std = (r: FreeRoomDto) => String(base.data?.cats.find((c) => c.id === r.categoryId)?.stdOccupancy ?? 2);

  // Auswahl an die freien Zimmer anpassen; Vorauswahl aus dem Belegungsplan übernehmen
  useEffect(() => {
    if (!free.data) return;
    setPicks((cur) => {
      const next: Record<string, Pick> = {};
      for (const r of free.data!) if (cur[r.id]) next[r.id] = cur[r.id]!;
      const lost = Object.keys(cur).filter((id) => !next[id]);
      setDropped(lost.map((id) => base.data?.rooms.find((x) => x.id === id)?.number ?? '').filter(Boolean));
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

  // Preis des Zimmers für die gewählte Personenzahl (Nachlass bei Einzelbelegung, Aufpreis für Zusatzpersonen)
  const quoteFor = (r: FreeRoomDto, p: Pick) => {
    const adj = r.pricing ? personAdjust(r.pricing, Number(p.adults) || 0, Number(p.children) || 0).cents : 0;
    return Math.max(0, r.quoteCents + adj * nights);
  };
  const selected = (free.data ?? []).filter((r) => picks[r.id]);
  const total = useMemo(() => selected.reduce((s, r) => {
    const manual = parseMoney(picks[r.id]!.price);
    return s + (Number.isNaN(manual) ? quoteFor(r, picks[r.id]!) : manual * nights);
  }, 0), [selected, picks, nights]);

  const f = useSubmit(bookingCreateInput, async (d) => {
    const r = await api<{ id: string; number: string }>('POST', '/bookings', d);
    toast(d.rooms[0]?.status === 'tentative' ? `Anfrage ${r.number} angelegt – Zimmer freigehalten bis ${deDate(d.optionUntil ?? '')}` : `Reservierung ${r.number} fest gebucht`);
    preset.onCreated?.(r.id);
    bump();
    onClose();
  });
  const submit = async (status: 'confirmed' | 'tentative') => {
    setSending(status);
    await f.submit(payload(status));
    setSending(null);
  };
  const payload = (status: 'confirmed' | 'tentative') => ({
    ...(guest ? { guestId: guest.id } : draft.lastName.trim() ? { guest: draft } : {}),
    ...meta, breakfast, ...(companyId ? { companyId } : {}), ...(status === 'tentative' ? { optionUntil: option } : {}),
    rooms: selected.map((r) => {
      const p = picks[r.id]!;
      return { roomId: r.id, from, to, status, adults: Number(p.adults), children: Number(p.children), pricePerNightCents: p.price.trim() === '' ? null : parseMoney(p.price) };
    }),
  });
  const otherErrors = Object.entries(f.errors).filter(([k]) => !k.startsWith('guest.')).map(([, m]) => m);
  const toggle = (r: FreeRoomDto) => { setDropped([]); setPicks((cur) => {
    const next = { ...cur };
    if (next[r.id]) delete next[r.id]; else next[r.id] = { adults: std(r), children: '0', price: '' };
    return next;
  }); };
  const setPick = (id: string, patch: Partial<Pick>) => setPicks((cur) => ({ ...cur, [id]: { ...cur[id]!, ...patch } }));

  return (
    <Dialog title="Neue Reservierung" onClose={onClose} size="xl"
      footer={<><span className="left total">{selected.length > 0 && <>{selected.length} Zimmer · {nights} {nights === 1 ? 'Nacht' : 'Nächte'} · <b>{formatMoney(total)}</b> Logis</>}</span>
        <span className="nb-actions"><Button onClick={onClose}>Abbrechen</Button>
          <Button busy={sending === 'tentative'} disabled={!!sending} onClick={() => void submit('tentative')} title={`Zimmer wird bis ${deDate(option)} freigehalten; später bestätigen oder stornieren`}>Als Anfrage anlegen</Button>
          <Button variant="primary" busy={sending === 'confirmed'} disabled={!!sending} onClick={() => void submit('confirmed')}>Fest buchen</Button></span></>}>
      {/* Enter löst absichtlich nichts aus: ob Anfrage oder feste Buchung, entscheidet der Knopf */}
      <form onSubmit={(e) => e.preventDefault()} noValidate>
      <div className="formgrid cols3 nb-dates">
        <Field label="Anreise"><input type="date" value={from} onChange={(e) => { setFrom(e.target.value); if (isIsoDate(e.target.value) && e.target.value >= to) setTo(addDays(e.target.value, 1)); }} /></Field>
        <Field label="Abreise" error={!valid ? 'Muss nach der Anreise liegen' : undefined} hint={valid ? `${nights} ${nights === 1 ? 'Nacht' : 'Nächte'}` : undefined}><input type="date" value={to} min={isIsoDate(from) ? addDays(from, 1) : undefined} onChange={(e) => setTo(e.target.value)} /></Field>
        <Field label="Bei Anfrage: Option bis" hint="so lange bleibt das Zimmer freigehalten – danach erinnert die Übersicht"><input type="date" value={option} min={today} max={isIsoDate(from) && from >= today ? from : undefined} onChange={(e) => setOptionUntil(e.target.value)} /></Field>
      </div>
      <section className="roomboard" aria-label="Zimmer wählen">
        <div className="roomboard-head">
          <h3 className="first">Zimmer wählen{valid && free.data ? <small className="inl"> · {free.data.length} frei {deDate(from)} – {deDate(to)}</small> : null}</h3>
          <div className="catlegend">{[...(base.data?.cats ?? [])].sort((a, b) => a.sort - b.sort).filter((c) => base.data?.rooms.some((r) => r.categoryId === c.id)).map((c) => (
            <span key={c.id} className={`cat-${catColorIndex(base.data?.cats, c.id)}`}><i className="catdot" />{c.name}</span>))}</div>
        </div>
        {free.error && <p className="notice danger">{free.error}</p>}
        {dropped.length > 0 && <p className="notice warn">Im neuen Zeitraum belegt und deshalb abgewählt: Zimmer {dropped.join(', ')}.</p>}
        {valid && free.data?.length === 0 && <p className="notice warn">In diesem Zeitraum ist kein Zimmer frei.</p>}
        {groupByFloor(base.data?.rooms ?? []).map((g) => (
          <div key={g.floor} className="floorrow">
            <div className="floorlabel">{g.label}</div>
            <div className="roomtiles">
              {g.rooms.map((room) => {
                const fr = free.data?.find((x) => x.id === room.id);
                const on = !!picks[room.id];
                return (
                  <button key={room.id} type="button" disabled={!fr} aria-pressed={on} onClick={() => fr && toggle(fr)}
                    className={`roomtile cat-${catColorIndex(base.data?.cats, room.categoryId)}${on ? ' on' : ''}${fr ? '' : ' taken'}`}
                    title={fr ? `${room.categoryName} – ${formatMoney(fr.quoteCents)} für ${nights} ${nights === 1 ? 'Nacht' : 'Nächte'}` : `${room.categoryName} – im Zeitraum belegt`}>
                    <b>{room.number}</b><small>{room.categoryName}</small>
                    <span className="rt-price">{!valid ? '' : !free.data ? '…' : fr ? `${formatMoney(Math.round(fr.quoteCents / Math.max(1, nights)))}/Nacht` : 'belegt'}</span>
                    {on && <i className="rt-check" aria-hidden>✓</i>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </section>
      <div className="split">
        <div>
          <h3 className="first">Gewählte Zimmer</h3>
          {selected.length === 0 && <p className="muted">Noch kein Zimmer gewählt – oben ein freies Zimmer antippen.</p>}
          <div className="roompick">
            {selected.map((r) => {
              const p = picks[r.id]!;
              return (
                <div key={r.id} className={`pickrow on cat-${catColorIndex(base.data?.cats, r.categoryId)}`}>
                  <span className="pickname"><i className="catdot" /><b>Zimmer {r.number}</b> <small className="inl">{r.categoryName}</small></span>
                  <div className="pickedit">
                    <label><small>Erw.</small><input type="number" min={1} value={p.adults} onChange={(e) => setPick(r.id, { adults: e.target.value })} /></label>
                    <label><small>Kinder</small><input type="number" min={0} value={p.children} onChange={(e) => setPick(r.id, { children: e.target.value })} /></label>
                    <label><small>Preis/Nacht</small><input inputMode="decimal" value={p.price} placeholder={nights ? (quoteFor(r, p) / nights / 100).toFixed(2).replace('.', ',') : ''} onChange={(e) => setPick(r.id, { price: e.target.value })} /></label>
                  </div>
                  <button type="button" className="iconbtn" aria-label={`Zimmer ${r.number} abwählen`} title="abwählen" onClick={() => toggle(r)}>✕</button>
                </div>
              );
            })}
          </div>
          {selected.length > 0 && <p className="muted small">Preis/Nacht leer lassen = Preis nach Preisregeln und Personenzahl. Ein eingetragener Betrag gilt als Sonderpreis für alle Nächte.</p>}
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
            <Field label="Notiz (intern)" wide hint="bei Anfragen z. B. „ruft Freitag zurück“ – steht dann in der Anfrageliste"><textarea rows={2} placeholder="z. B. ruft Freitag zurück, möchte ruhiges Zimmer" value={meta.notes} onChange={(e) => setMeta({ ...meta, notes: e.target.value })} /></Field>
          </div>
          {otherErrors.length > 0 && <p className="notice danger" role="alert">{[...new Set(otherErrors)].join(' · ')}</p>}
        </aside>
      </div>
      </form>
    </Dialog>
  );
}
