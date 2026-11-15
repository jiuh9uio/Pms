import { useEffect, useState } from 'react';
import { floorPlanInput, type Corridor, type FloorPlan, type FloorPlanDto } from '../../../src/shared/floorplan.js';
import { addDays, todayBerlin } from '../../../src/shared/hotel.js';
import { api } from '../api.ts';
import { useAuth } from '../App.tsx';
import { useData } from '../data.tsx';
import { deDate } from '../hotel/common.tsx';
import { FloorPlanView, type PlanTile } from '../hotel/FloorPlanView.tsx';
import { Button, Dialog, Field, LoadState, PageHeader, useLoad, useToast } from '../ui.tsx';

/** Etagenplan: Zimmer als schematischer Grundriss mit Status; Klick öffnet Buchung bzw. neue Reservierung. Aktualisiert sich selbst. */
export function FloorPlanPage() {
  const { user } = useAuth();
  const toast = useToast();
  const { rev, openBooking, newBooking } = useData();
  const today = todayBerlin();
  const [date, setDate] = useState(today);
  const [tick, setTick] = useState(0);
  const [edit, setEdit] = useState(false);
  // alle 30 Sekunden neu laden, damit Änderungen an anderen Geräten sichtbar werden
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 30_000); return () => clearInterval(t); }, []);
  const { data, error, reload } = useLoad(() => api<FloorPlanDto>('GET', `/floorplan?date=${date}`), [date, rev, tick]);
  const tiles: PlanTile[] = (data?.rooms ?? []).map((r) => ({
    id: r.id, number: r.number, category: r.category, floor: r.floor, status: r.status,
    title: r.status === 'blocked' ? r.blockNote : r.guest ? `${r.guest}${r.to ? ` bis ${deDate(r.to)}` : ''}` : '',
    sub: r.status === 'occupied' || r.status === 'reserved' ? (r.guest.split(' ').at(-1) || r.category) : r.status === 'blocked' ? 'gesperrt' : r.category,
  }));
  const click = (t: PlanTile) => {
    const r = data?.rooms.find((x) => x.id === t.id);
    if (!r) return;
    if (r.bookingId) openBooking(r.bookingId);
    else if (r.status === 'free') newBooking({ roomId: r.id, from: date, to: addDays(date, 1) });
    else toast(`Zimmer ${r.number}: ${r.blockNote}`, 'error');
  };
  const count = (s: string) => (data?.rooms ?? []).filter((r) => r.status === s).length;
  return (
    <>
      <PageHeader title="Etagenplan" sub={`${deDate(date)}${date === today ? ' · heute' : ''} – Nacht vom ${deDate(date)} auf ${deDate(addDays(date, 1))}`}
        actions={<>
          <Button onClick={() => setDate(addDays(date, -1))} aria-label="Vorheriger Tag">‹</Button>
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Datum" />
          <Button onClick={() => setDate(addDays(date, 1))} aria-label="Nächster Tag">›</Button>
          {date !== today && <Button onClick={() => setDate(today)}>Heute</Button>}
          {user.role === 'admin' && <Button onClick={() => setEdit(true)}>Plan bearbeiten</Button>}
        </>} />
      <LoadState error={error} loading={!data} />
      {data && (
        <>
          <div className="fp-counts">
            <span className="st-free"><b>{count('free')}</b> frei</span><span className="st-occupied"><b>{count('occupied')}</b> belegt</span>
            <span className="st-reserved"><b>{count('reserved')}</b> reserviert</span><span className="st-blocked"><b>{count('blocked')}</b> gesperrt</span>
          </div>
          <div className="card"><FloorPlanView plan={data.plan} tiles={tiles} onRoom={click} /></div>
          <p className="muted small">Klick auf ein belegtes oder reserviertes Zimmer öffnet die Reservierung, auf ein freies Zimmer eine neue Reservierung für diese Nacht. Der Status kommt aus denselben Buchungen wie der Belegungsplan; die Lage der Zimmer ist nur eine Ansicht und ändert keine Buchung.</p>
        </>
      )}
      {edit && data && <PlanEditor plan={data.plan} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); reload(); }} />}
    </>
  );
}

const list = (s: string) => s.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);

/** Administrator: Flure, Straßen-/Hofseite, Reihenfolge (gleicher Platz = gegenüber, „-“ = Lücke), Treppenhaus. */
function PlanEditor({ plan, onClose, onSaved }: { plan: FloorPlan; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const rooms = useLoad(() => api<{ number: string }[]>('GET', '/rooms')).data;
  type Row = Omit<Corridor, 'street' | 'court'> & { street: string; court: string };
  const [rows, setRows] = useState<Row[]>(plan.corridors.map((c) => ({ ...c, street: c.street.join(', '), court: c.court.join(', ') })));
  const [street, setStreet] = useState(Object.entries(plan.sides).filter(([, s]) => s === 'street').map(([n]) => n).join(', '));
  const [court, setCourt] = useState(Object.entries(plan.sides).filter(([, s]) => s === 'court').map(([n]) => n).join(', '));
  const [assumed, setAssumed] = useState(plan.stairsAssumed);
  const [busy, setBusy] = useState(false);
  const set = (i: number, p: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const all = [...rows.flatMap((r) => [...list(r.street), ...list(r.court)]), ...list(street), ...list(court)].filter((n) => n !== '-');
  const known = new Set((rooms ?? []).map((r) => r.number));
  const unknown = rooms ? [...new Set(all.filter((n) => !known.has(n)))] : [];
  const twice = [...new Set(all.filter((n, i) => all.indexOf(n) !== i))];
  const save = async () => {
    const sides: Record<string, 'street' | 'court'> = {};
    for (const n of list(street)) sides[n] = 'street';
    for (const n of list(court)) sides[n] = 'court';
    const v = floorPlanInput.safeParse({ corridors: rows.map((r) => ({ ...r, street: list(r.street), court: list(r.court) })), sides, stairsAssumed: assumed });
    if (!v.success) { toast('Bitte die Eingaben prüfen (höchstens 40 Zimmer je Reihe, Namen bis 60 Zeichen).', 'error'); return; }
    setBusy(true);
    try { await api('PUT', '/settings/floor-plan', v.data); toast('Etagenplan gespeichert'); onSaved(); }
    catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
    setBusy(false);
  };
  return (
    <Dialog title="Etagenplan bearbeiten" onClose={onClose} size="lg"
      footer={<><Button onClick={onClose}>Abbrechen</Button><Button variant="primary" busy={busy} onClick={() => void save()}>Speichern</Button></>}>
      <p className="muted">Zimmernummern mit Komma trennen, in der Reihenfolge entlang des Flurs. Gleicher Platz in Straßen- und Hofseite = gegenüber; „-“ lässt einen Platz frei. Die Etage gilt nur für die Überschrift. Buchungen und Zimmer werden hier nicht verändert.</p>
      {rows.map((r, i) => (
        <fieldset key={r.id} className="gsec fp-edit">
          <legend>Flur {i + 1}</legend>
          <div className="formgrid cols3">
            <Field label="Name"><input value={r.name} maxLength={60} onChange={(e) => set(i, { name: e.target.value })} /></Field>
            <Field label="Etage" hint="z. B. 1, EG, DG"><input value={r.floor} maxLength={20} onChange={(e) => set(i, { floor: e.target.value })} /></Field>
            <Field label="Treppenhaus"><select value={r.stairs} onChange={(e) => set(i, { stairs: e.target.value as Row['stairs'] })}><option value="none">keins</option><option value="start">am Anfang</option><option value="end">am Ende</option></select></Field>
            <Field label="Straßenseite (Fenster)" wide><input value={r.street} onChange={(e) => set(i, { street: e.target.value })} placeholder="z. B. 111, 112, 113" /></Field>
            <Field label="Hofseite" wide><input value={r.court} onChange={(e) => set(i, { court: e.target.value })} placeholder="z. B. -, 120" /></Field>
          </div>
          <Button variant="danger" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Flur entfernen</Button>
        </fieldset>
      ))}
      <p><Button onClick={() => setRows([...rows, { id: `f${Date.now().toString(36)}`, name: `Flur ${rows.length + 1}`, floor: '', street: '', court: '', stairs: 'none' }])}>+ Flur hinzufügen</Button></p>
      <h3>Gebäudeseite bekannt, Flur noch nicht</h3>
      <div className="formgrid">
        <Field label="Straßenseite"><input value={street} onChange={(e) => setStreet(e.target.value)} placeholder="z. B. 224" /></Field>
        <Field label="Hofseite"><input value={court} onChange={(e) => setCourt(e.target.value)} placeholder="z. B. 120" /></Field>
        <label className="check wide"><input type="checkbox" checked={!assumed} onChange={(e) => setAssumed(!e.target.checked)} /><span>Lage des Treppenhauses ist geprüft<small>Solange nicht angehakt, steht im Plan ein Hinweis, dass die Lage nur angenommen ist.</small></span></label>
      </div>
      {unknown.length > 0 && <p className="notice warn">Diese Nummern gibt es (noch) nicht als Zimmer: {unknown.join(', ')}. Sie erscheinen im Plan gestrichelt als „nicht angelegt“.</p>}
      {twice.length > 0 && <p className="notice warn">Mehrfach eingetragen: {twice.join(', ')}.</p>}
    </Dialog>
  );
}
