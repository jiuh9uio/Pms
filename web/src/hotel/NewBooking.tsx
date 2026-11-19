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
 * Neue Reservierung Schritt für Schritt:
 * 1 Art: feste Reservierung oder Anfrage → 2 Zeitraum wählen und Zimmer antippen (nach Etagen; grün = frei, rot = belegt) →
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
  const roomsOk = valid && selected.length > 0;
  /** bis zu welchem Schritt man vorspringen darf */
  const reachable = !kind ? 1 : !roomsOk ? 2 : !hasGuest || !contactOk ? 3 : 4;
  const STEPS = ['Art', 'Zimmer', 'Gast', 'Fertig'];
  const blockReason = step === 1 && !kind ? 'Bitte „Feste Reservierung“ oder „Anfrage“ wählen'
    : step === 2 && !roomsOk ? (!valid ? 'Bitte Anreise und Abreise wählen' : 'Bitte ein grünes (freies) Zimmer antippen')
    : step === 3 && !hasGuest ? 'Bitte einen Gast wählen oder mindestens den Nachnamen eintragen'
    : step === 3 && !contactOk ? 'Für den Rückruf bzw. die Bestätigung bitte Telefon oder E-Mail eintragen' : '';
  const next = () => { if (!blockReason && step < 4) setStep(step + 1); };
  const sourceAndPay = [meta.source, meta.paymentMethod ? `Zahlung: ${meta.paymentMethod}` : 'Zahlung offen'].join(' · ');
  const isTentative = kind === 'tentative';

  const setDates = (a: string, n: number) => { setFrom(a); setTo(addDays(a, n)); };
  const chip = (label: string, on: boolean, click: () => void) => <button type="button" className={`nbchip${on ? ' on' : ''}`} aria-pressed={on} onClick={click}>{label}</button>;

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
        <section className="nbstep">
          <h3 className="first">Wann?</h3>
          <div className="formgrid cols3 nb-dates">
            <Field label="Anreise" hint="Abreise wird automatisch eingetragen (gleiche Anzahl Nächte, sonst 1)"><input type="date" value={from} min={today} onChange={(e) => { const v = e.target.value; setFrom(v); if (isIsoDate(v)) setTo(addDays(v, nights > 0 ? nights : 1)); }} /></Field>
            <Field label="Abreise" error={!valid ? 'Muss nach der Anreise liegen' : undefined} hint={valid ? `${nights} ${nights === 1 ? 'Nacht' : 'Nächte'}` : undefined}><input type="date" value={to} min={isIsoDate(from) ? addDays(from, 1) : undefined} onChange={(e) => setTo(e.target.value)} /></Field>
          </div>
          <div className="nbchips"><span className="muted small">Anreise:</span>
            {chip('heute', from === today, () => setDates(today, Math.max(1, nights)))}
            {chip('morgen', from === addDays(today, 1), () => setDates(addDays(today, 1), Math.max(1, nights)))}
            <span className="muted small">Dauer:</span>
            {[1, 2, 3, 7].map((n) => chip(`${n} ${n === 1 ? 'Nacht' : 'Nächte'}`, valid && nights === n, () => isIsoDate(from) && setTo(addDays(from, n))))}
          </div>
        </section>
        <section className="roomboard nbrooms" aria-label="Zimmer wählen">
          <div className="roomboard-head">
            <h3 className="first">Welches Zimmer?{valid && free.data ? <small className="inl"> · {deDate(from)} – {deDate(to)} · {free.data.length} frei</small> : null}</h3>
            <div className="nblegend"><span className="lg-free">frei</span><span className="lg-taken">belegt</span><span className="lg-on">gewählt</span></div>
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
                  const loading = valid && !free.data;
                  return (
                    <button key={room.id} type="button" disabled={!fr} aria-pressed={on} onClick={() => fr && toggle(fr)}
                      className={`roomtile cat-${catColorIndex(base.data?.cats, room.categoryId)}${on ? ' on' : ''}${loading ? '' : fr ? ' free' : ' taken'}`}
                      title={fr ? `${room.categoryName} – frei, ${formatMoney(fr.quoteCents)} für ${nights} ${nights === 1 ? 'Nacht' : 'Nächte'}` : `${room.categoryName} – im Zeitraum belegt`}>
                      <b>{room.number}</b><small>{room.categoryName}</small>
                      <span className="rt-price">{!valid ? '' : loading ? '…' : fr ? `frei · ${formatMoney(Math.round(fr.quoteCents / Math.max(1, nights)))}/Nacht` : 'belegt'}</span>
                      {on && <i className="rt-check" aria-hidden>✓</i>}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </section>
        {selected.length > 0 && (<>
          <h3>Gewählte Zimmer</h3>
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
