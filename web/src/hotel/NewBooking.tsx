import { useEffect, useMemo, useState } from 'react';
import {
  PAYMENT_METHODS, SOURCES, addDays, bookingCreateInput, diffDays, formatMoney, isIsoDate, parseMoney, personAdjust, todayBerlin, weekdayOf,
  type CalendarDto, type CategoryDto, type FreeRoomDto, type GuestDto, type RoomDto, type ServiceDto,
} from '../../../src/shared/hotel.js';
import type { HotelSettings } from '../../../src/shared/schemas.js';
import { api } from '../api.ts';
import { useData, type NewPreset } from '../data.tsx';
import { Button, Dialog, Field, useLoad, useSubmit, useToast } from '../ui.tsx';
import { GuestFields, WD, deDate, deShort, toDraft, type GuestDraft } from './common.tsx';
import { CompanySelect } from './CompanySelect.tsx';
import { catColorIndex, groupByFloor } from './roomgroups.ts';

interface Pick { adults: string; children: string; price: string }

/**
 * Neue Reservierung Schritt für Schritt:
 * 1 Art: feste Reservierung oder Anfrage → 2 Zimmer im Belegungsplan antippen (Anreisetag, dann letzte Nacht) →
 * 3 Gast (bei Anfragen mit Telefon oder E-Mail für Rückruf/Bestätigung) → 4 Fertig: Extras, Übersicht, ein Knopf.
 * Anfragen landen im Anfragen-Ordner (vorläufig, Zimmer bis „Option bis“ freigehalten).
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
  // Schritt für Schritt: 1 Art · 2 Zimmer (Plan) · 3 Gast · 4 Fertig
  const [step, setStep] = useState(1);
  const [kind, setKind] = useState<'confirmed' | 'tentative' | null>(null);
  /** Plan: erster Tag der angezeigten zwei Wochen; pending = Anreise angetippt, letzte Nacht noch offen */
  const [planStart, setPlanStart] = useState(() => addDays(preset.from ?? todayBerlin(), -1) < todayBerlin() ? todayBerlin() : addDays(preset.from ?? todayBerlin(), -1));
  const [pending, setPending] = useState(false);
  const [planMsg, setPlanMsg] = useState('');

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
    toast(d.rooms[0]?.status === 'tentative' ? `Anfrage ${r.number} gespeichert – liegt im Anfragen-Ordner, Zimmer vorgemerkt bis ${deDate(d.optionUntil ?? '')}` : `Reservierung ${r.number} fest gebucht`);
    preset.onCreated?.(r.id);
    bump();
    onClose();
  });
  const submit = async (status: 'confirmed' | 'tentative') => {
    setSending(status);
    await f.submit(payload(status));
    setSending(null);
  };
  // Fehler vom Server: zum Schritt springen, in dem das Feld steht
  useEffect(() => {
    const keys = Object.keys(f.errors);
    if (keys.some((k) => k.startsWith('guest'))) setStep(3);
    else if (keys.some((k) => k.startsWith('rooms'))) setStep(2);
  }, [f.errors]);
  const PLAN_DAYS = 14;
  const plan = useLoad(() => api<CalendarDto>('GET', `/calendar?from=${planStart}&days=${PLAN_DAYS}`), [planStart]);
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

  const guestName = guest ? [guest.firstName, guest.lastName].filter(Boolean).join(' ') : [draft.firstName, draft.lastName].filter((x) => x.trim()).join(' ');
  const hasGuest = !!guest || draft.lastName.trim() !== '';
  const phone = guest ? guest.phone ?? '' : draft.phone;
  const email = guest ? guest.email ?? '' : draft.email;
  const contactOk = kind !== 'tentative' || !!(phone?.trim() || email?.trim());
  const roomsOk = valid && selected.length > 0 && !pending;
  /** bis zu welchem Schritt man vorspringen darf */
  const reachable = !kind ? 1 : !roomsOk ? 2 : !hasGuest || !contactOk ? 3 : 4;
  const STEPS = ['Art', 'Zimmer', 'Gast', 'Fertig'];
  const blockReason = step === 1 && !kind ? 'Bitte „Feste Reservierung“ oder „Anfrage“ wählen'
    : step === 2 && !roomsOk ? (pending ? 'Bitte noch die letzte Nacht im Plan antippen' : 'Bitte im Plan ein freies Zimmer antippen')
    : step === 3 && !hasGuest ? 'Bitte einen Gast wählen oder mindestens den Nachnamen eintragen'
    : step === 3 && !contactOk ? 'Für den Rückruf bzw. die Bestätigung bitte Telefon oder E-Mail eintragen' : '';
  const next = () => { if (!blockReason && step < 4) setStep(step + 1); };
  const sourceAndPay = [meta.source, meta.paymentMethod ? `Zahlung: ${meta.paymentMethod}` : 'Zahlung offen'].join(' · ');
  const isTentative = kind === 'tentative';

  // ---------- Plan ----------
  const planDays = Array.from({ length: PLAN_DAYS }, (_, i) => addDays(planStart, i));
  const busyOn = (roomId: string, d: string) => plan.data?.entries.find((e) => e.roomId === roomId && e.from <= d && d < e.to);
  const freeRange = (roomId: string, a: string, b: string) => { for (let d = a; d < b; d = addDays(d, 1)) if (busyOn(roomId, d)) return d; return null; };
  const roomOf = (id: string) => base.data?.rooms.find((r) => r.id === id);
  const pickRoom = (id: string) => { const cat = base.data?.cats.find((c) => c.id === roomOf(id)?.categoryId); return { adults: String(cat?.stdOccupancy ?? 2), children: '0', price: '' }; };
  const clickCell = (roomId: string, d: string) => {
    setPlanMsg(''); setDropped([]);
    if (d < today) return;
    const on = !!picks[roomId];
    // Ende festlegen: gleiches Zimmer, Tag ab Anreise
    if (pending && on && d >= from) {
      const clash = freeRange(roomId, from, addDays(d, 1));
      if (clash) { setPlanMsg(`Zimmer ${roomOf(roomId)?.number} ist am ${deDate(clash)} belegt – bitte eine frühere letzte Nacht wählen.`); return; }
      setTo(addDays(d, 1)); setPending(false); return;
    }
    // weiteres Zimmer für denselben Zeitraum
    if (!pending && selected.length > 0 && d >= from && d < to) {
      if (on) { setPicks((cur) => { const n = { ...cur }; delete n[roomId]; return n; }); return; }
      const clash = freeRange(roomId, from, to);
      if (clash) { setPlanMsg(`Zimmer ${roomOf(roomId)?.number} ist am ${deDate(clash)} belegt und passt nicht in den Zeitraum.`); return; }
      setPicks((cur) => ({ ...cur, [roomId]: pickRoom(roomId) })); return;
    }
    // neu anfangen: Anreise in diesem Zimmer
    if (busyOn(roomId, d)) return;
    setFrom(d); setTo(addDays(d, 1)); setPicks({ [roomId]: pickRoom(roomId) }); setPending(true);
  };
  const inSel = (roomId: string, d: string) => !!picks[roomId] && d >= from && d < to;

  return (
    <Dialog title={kind === 'tentative' ? 'Neue Anfrage' : kind === 'confirmed' ? 'Neue feste Reservierung' : 'Neue Reservierung'} onClose={onClose} size="xl"
      footer={<><span className="left total">{selected.length > 0 && valid && <>{selected.length} Zimmer · {nights} {nights === 1 ? 'Nacht' : 'Nächte'} · <b>{formatMoney(total)}</b> Logis</>}</span>
        <span className="nb-actions">
          {step === 1 ? <Button onClick={onClose}>Abbrechen</Button> : <Button onClick={() => setStep(step - 1)}>← Zurück</Button>}
          {step < 4 && <Button variant="primary" disabled={!!blockReason} title={blockReason || undefined} onClick={next}>Weiter →</Button>}
          {step === 4 && (isTentative
            ? <Button variant="primary" busy={sending === 'tentative'} disabled={!!sending} onClick={() => void submit('tentative')}>Anfrage speichern</Button>
            : <Button variant="primary" busy={sending === 'confirmed'} disabled={!!sending} onClick={() => void submit('confirmed')}>Fest buchen</Button>)}
        </span></>}>
      <ol className="nbsteps" aria-label="Schritte">
        {STEPS.map((label, i) => {
          const n = i + 1;
          return (
            <li key={label} className={n === step ? 'now' : n < step ? 'done' : ''}>
              <button type="button" disabled={n > reachable && n > step} aria-current={n === step ? 'step' : undefined} onClick={() => setStep(n)}>
                <span className="nbnum">{n < step ? '✓' : n}</span><span className="nblabel">{label}</span>
              </button>
            </li>
          );
        })}
      </ol>
      {step > 1 && blockReason && <p className="muted small nbhint">{blockReason}</p>}
      <form onSubmit={(e) => { e.preventDefault(); if (step < 4) next(); }} noValidate>

      {step === 1 && (
        <section className="nbstep">
          <h3 className="first">Was möchten Sie anlegen?</h3>
          <div className="nbkinds">
            <button type="button" className={kind === 'confirmed' ? 'on' : ''} aria-pressed={kind === 'confirmed'} onClick={() => { setKind('confirmed'); setStep(2); }}>
              <b>Feste Reservierung</b><span>Der Gast hat verbindlich zugesagt. Das Zimmer ist gebucht.</span></button>
            <button type="button" className={kind === 'tentative' ? 'on' : ''} aria-pressed={kind === 'tentative'} onClick={() => { setKind('tentative'); setStep(2); }}>
              <b>Anfrage</b><span>Der Gast fragt erst an. Das Zimmer wird vorgemerkt, die Anfrage landet im Anfragen-Ordner – zum Rückruf oder für die Bestätigungs-E-Mail.</span></button>
          </div>
        </section>
      )}

      {step === 2 && (<>
        <div className="nbplanbar">
          <div className="stepper">
            <Button onClick={() => setPlanStart(addDays(planStart, -7))} aria-label="Eine Woche zurück">‹</Button>
            <Button onClick={() => setPlanStart(today)}>Heute</Button>
            <Button onClick={() => setPlanStart(addDays(planStart, 7))} aria-label="Eine Woche weiter">›</Button>
          </div>
          <label className="inlinelabel">Anreise <input type="date" value={from} min={today} onChange={(e) => { const v = e.target.value; if (!isIsoDate(v)) return; setFrom(v); if (v >= to) setTo(addDays(v, 1)); setPending(false); if (v < planStart || v >= addDays(planStart, PLAN_DAYS)) setPlanStart(v); }} /></label>
          <label className="inlinelabel">Abreise <input type="date" value={to} min={isIsoDate(from) ? addDays(from, 1) : undefined} onChange={(e) => { if (isIsoDate(e.target.value)) { setTo(e.target.value); setPending(false); } }} /></label>
          {valid && <span className="muted small">{nights} {nights === 1 ? 'Nacht' : 'Nächte'}</span>}
        </div>
        <p className="muted small">Im Plan auf den <b>Anreisetag</b> im gewünschten Zimmer tippen, dann auf die <b>letzte Nacht</b>. Weitere Zimmer für denselben Zeitraum: in deren Zeile innerhalb des Zeitraums antippen. Grau = belegt.</p>
        {planMsg && <p className="notice warn">{planMsg}</p>}
        {dropped.length > 0 && <p className="notice warn">Im neuen Zeitraum belegt und deshalb abgewählt: Zimmer {dropped.join(', ')}.</p>}
        {plan.error && <p className="notice danger">{plan.error}</p>}
        <div className="nbplanwrap">
          <table className="nbplan">
            <thead><tr><th className="nbroom">Zimmer</th>{planDays.map((d) => <th key={d} className={[d === today ? 'today' : '', weekdayOf(d) === 0 || weekdayOf(d) === 6 ? 'we' : ''].join(' ')}><small>{WD[weekdayOf(d)]}</small><br />{deShort(d)}</th>)}</tr></thead>
            <tbody>
              {groupByFloor(base.data?.rooms ?? []).flatMap((g) => g.rooms).map((room) => (
                <tr key={room.id} className={picks[room.id] ? 'picked' : ''}>
                  <th className={`nbroom cat-${catColorIndex(base.data?.cats, room.categoryId)}`}><i className="catdot" /><b>{room.number}</b><small>{room.categoryName}</small></th>
                  {planDays.map((d) => {
                    const busy = busyOn(room.id, d);
                    const sel = inSel(room.id, d);
                    const past = d < today;
                    const label = busy ? (busy.kind === 'block' ? 'gesperrt' : busy.guestName ?? 'belegt') : sel ? (d === from ? 'Anreise' : '') : '';
                    return (
                      <td key={d} className={[busy ? (busy.kind === 'block' ? 'blk' : 'busy') : '', sel ? 'sel' : '', past ? 'past' : ''].join(' ')}>
                        <button type="button" disabled={(!!busy && !sel) || past} title={busy ? `${room.number}: ${busy.kind === 'block' ? 'gesperrt' : `belegt (${busy.guestName ?? ''})`}` : `Zimmer ${room.number}, ${deDate(d)}`}
                          aria-label={`Zimmer ${room.number} ${deDate(d)}${busy ? ' belegt' : sel ? ' gewählt' : ' frei'}`} onClick={() => clickCell(room.id, d)}>{label}</button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {selected.length > 0 && !pending && (<>
          <h3>Gewählte Zimmer · {deDate(from)} – {deDate(to)}</h3>
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
          <p className="muted small">Preis/Nacht leer lassen = Preis nach Preisregeln und Personenzahl. Ein eingetragener Betrag gilt als Sonderpreis für alle Nächte.</p>
        </>)}
      </>)}

      {step === 3 && (
        <section className="nbstep">
          <h3 className="first">Wer kommt?</h3>
          {isTentative && <p className="notice">Für die Anfrage bitte <b>Telefon</b> (zum Rückruf) oder <b>E-Mail</b> (für die Bestätigung) eintragen – beides steht dann im Anfragen-Ordner.</p>}
          {guest ? (
            <>
              <div className="chosen"><span><b>{guestName}</b><br /><small>{[guest.company, guest.city, guest.phone, guest.email].filter(Boolean).join(' · ') || 'aus der Gästekartei'}</small></span>
                <Button onClick={() => setGuest(null)}>Anderen Gast</Button></div>
              {!contactOk && <p className="notice warn">Bei diesem Gast sind weder Telefon noch E-Mail gespeichert. Bitte „Anderen Gast“ wählen und neu eintragen oder die Gästekarte ergänzen.</p>}
            </>
          ) : (
            <>
              <Field label="Schon einmal da gewesen? In der Gästekartei suchen" wide>
                <input type="search" placeholder="Name, Firma oder Ort …" value={q} autoFocus onChange={(e) => setQ(e.target.value)} />
              </Field>
              {hits.length > 0 && (
                <div className="hits">
                  {hits.map((g) => (
                    <button type="button" key={g.id} onClick={() => { setGuest(g); setQ(''); setHits([]); }}>
                      <b>{[g.firstName, g.lastName].filter(Boolean).join(' ')}</b> <small>{[g.company, g.city, g.stays ? `${g.stays} Aufenthalte` : ''].filter(Boolean).join(' · ')}</small>
                    </button>
                  ))}
                </div>
              )}
              <h3>Oder neuen Gast eintragen</h3>
              <GuestFields value={draft} onChange={setDraft} errors={f.errors} prefix="guest." compact />
              {f.errors.guest && <p className="error">{f.errors.guest}</p>}
            </>
          )}
        </section>
      )}

      {step === 4 && (
        <section className="nbstep">
          <h3 className="first">{isTentative ? 'Anfrage fertigstellen' : 'Reservierung fertigstellen'}</h3>
          <dl className="nbsum">
            <dt>Gast</dt><dd>{guestName || '–'}{(phone || email) && <small className="inl"> · {[phone, email].filter(Boolean).join(' · ')}</small>} <button type="button" className="linkbtn" onClick={() => setStep(3)}>ändern</button></dd>
            <dt>Zeitraum</dt><dd>{deDate(from)} – {deDate(to)} · {nights} {nights === 1 ? 'Nacht' : 'Nächte'} <button type="button" className="linkbtn" onClick={() => setStep(2)}>ändern</button></dd>
            <dt>Zimmer</dt><dd>{selected.map((r) => `${r.number} (${picks[r.id]!.adults} Erw.${Number(picks[r.id]!.children) ? `, ${picks[r.id]!.children} Ki.` : ''})`).join(', ')}</dd>
            <dt>Logis</dt><dd><b>{formatMoney(total)}</b></dd>
          </dl>
          {isTentative && (
            <Field label="Zimmer vorgemerkt bis (Option)" hint="Bis dahin bleibt das Zimmer frei gehalten – danach erinnert die Übersicht an den Rückruf.">
              <input type="date" value={option} min={today} max={isIsoDate(from) && from >= today ? from : undefined} onChange={(e) => setOptionUntil(e.target.value)} />
            </Field>
          )}
          <h3>Extras (freiwillig)</h3>
          <div className="formgrid">
            {base.data?.breakfast && (
              <label className="check wide"><input type="checkbox" checked={breakfast} onChange={(e) => setBreakfast(e.target.checked)} />
                <span>Mit Frühstück <small className="inl">{formatMoney(base.data.breakfast.priceCents)} pro Person und Nacht</small></span></label>
            )}
            <Field label="Buchungsquelle"><select value={meta.source} onChange={(e) => setMeta({ ...meta, source: e.target.value })}>{SOURCES.map((x) => <option key={x}>{x}</option>)}</select></Field>
            <Field label="Zahlungsart"><select value={meta.paymentMethod} onChange={(e) => setMeta({ ...meta, paymentMethod: e.target.value })}><option value="">offen</option>{PAYMENT_METHODS.map((x) => <option key={x}>{x}</option>)}</select></Field>
            {selected.length > 1 && <Field label="Gruppenname" wide><input value={meta.groupName} onChange={(e) => setMeta({ ...meta, groupName: e.target.value })} placeholder="z. B. Hochzeit Müller" /></Field>}
            <Field label={isTentative ? 'Notiz zum Rückruf (intern)' : 'Notiz (intern)'} wide hint={isTentative ? 'steht im Anfragen-Ordner, z. B. „ruft Freitag zurück“' : undefined}><textarea rows={2} placeholder={isTentative ? 'z. B. ruft Freitag zurück, möchte ruhiges Zimmer' : 'z. B. möchte ruhiges Zimmer'} value={meta.notes} onChange={(e) => setMeta({ ...meta, notes: e.target.value })} /></Field>
          </div>
          <details className="nbmore"><summary>Firmenbuchung</summary>
            <CompanySelect value={companyId} onChange={(cid) => { setCompanyId(cid); if (cid) setMeta({ ...meta, source: 'Firma', paymentMethod: 'Rechnung an Firma' }); }} />
          </details>
          <p className="muted small">{sourceAndPay}</p>
          {otherErrors.length > 0 && <p className="notice danger" role="alert">{[...new Set(otherErrors)].join(' · ')}</p>}
        </section>
      )}
      </form>
    </Dialog>
  );
}
