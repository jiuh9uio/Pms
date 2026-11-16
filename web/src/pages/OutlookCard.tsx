import { useState } from 'react';
import { EFFECT_LABEL, OUTLOOK_EFFECTS, outlookEventInput, outlookSettingsInput, type Gauge, type OutlookDto, type OutlookEffect, type OutlookSettings, type WeatherSummary } from '../../../src/shared/outlook.js';
import { api } from '../api.ts';
import { useAuth } from '../App.tsx';
import { useData } from '../data.tsx';
import { Button, Dialog, Field, LoadState, useLoad, useSubmit, useToast } from '../ui.tsx';

const TONE: Record<Gauge['level'], string> = { niedrig: 'low', mittel: 'mid', hoch: 'high' };

/** Ausblick im Restaurant: Gäste ohne Reservierung und früher gehen – mit Gründen, Wetter, Fußball und eigenen Einträgen. */
export function OutlookCard({ date }: { date: string }) {
  const { user } = useAuth();
  const { rev, bump } = useData();
  const toast = useToast();
  const { data, error } = useLoad(() => api<OutlookDto>('GET', `/restaurant/outlook?date=${date}`), [date, rev]);
  const [adding, setAdding] = useState(false);
  const [setup, setSetup] = useState(false);
  const isAdmin = user.role === 'admin';
  const del = async (id: string) => {
    try { await api('DELETE', `/restaurant/events/${id}`); toast('Eintrag gelöscht'); bump(); } catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
  };
  return (
    <section className="card outlook noprint">
      <div className="cardhead">
        <h2>Ausblick{data ? ` · ${data.weekday}${data.holiday ? `, ${data.holiday}` : ''}` : ''}</h2>
        <div className="actions"><Button onClick={() => setAdding(true)}>+ Veranstaltung</Button>{isAdmin && <Button onClick={() => setSetup(true)}>Einstellen</Button>}</div>
      </div>
      {!data ? <LoadState error={error} loading /> : <>
        <div className="outlook-gauges">
          <GaugeBox title="Gäste ohne Reservierung" gauge={data.walkIn} />
          <GaugeBox title="Gäste gehen früher" gauge={data.leaveEarly} />
        </div>
        <div className="outlook-facts">
          <div><small>Wetter</small>
            {!data.weather.configured ? <span className="muted">{isAdmin ? 'Standort fehlt – unter „Einstellen“ eintragen' : 'noch kein Standort eingetragen'}</span>
              : data.weather.error ? <span className="muted">nicht abrufbar ({data.weather.error})</span>
              : <span>{wx('Mittag', data.weather.lunch)}{' · '}{wx('Abend', data.weather.dinner)}</span>}
          </div>
          <div><small>Fußball heute</small>
            {data.matches.length ? <span>{data.matches.map((m) => <span key={m.league + m.time + m.title} className={m.favorite ? 'strong' : ''}>{m.time} {m.title}<br /></span>)}</span>
              : <span className="muted">{data.matchesError ? `nicht abrufbar (${data.matchesError})` : 'keine Spiele gefunden'}</span>}
          </div>
          <div><small>Reserviert</small><span>{data.reservations.count} Reservierungen · {data.reservations.persons}{data.reservations.seats ? ` von ${data.reservations.seats}` : ''} Plätzen</span></div>
          <div><small>Veranstaltungen</small>
            {data.events.length ? <span>{data.events.map((e) => (
              <span key={e.id} className="outlook-ev">{e.time && `${e.time} `}{e.title} <small className="muted">({e.effect === 'more' ? 'bringt Gäste' : e.effect === 'fewer' ? 'hält fern' : 'früher gehen'})</small>
                <button type="button" className="iconbtn" aria-label={`${e.title} löschen`} title="löschen" onClick={() => { if (window.confirm(`„${e.title}“ löschen?`)) void del(e.id); }}>✕</button></span>))}</span>
              : <span className="muted">keine eingetragen</span>}
          </div>
        </div>
        {data.hints.map((h) => <p key={h} className="muted small">{h}</p>)}
        <p className="muted small">Grobe Einschätzung nach festen Regeln (Wochentag, bundesweite Feiertage, Wetter zu den Essenszeiten, Fußball, eigene Einträge) – keine Garantie. Wetter: {data.weather.source}; Fußball: OpenLigaDB (nur der aktuelle Spieltag der eingestellten Ligen).</p>
      </>}
      {adding && <EventDialog date={date} onClose={() => setAdding(false)} />}
      {setup && <SetupDialog onClose={() => setSetup(false)} />}
    </section>
  );
}

const wx = (label: string, s: WeatherSummary | null) => `${label}: ${s ? s.label : '–'}`;

function GaugeBox({ title, gauge }: { title: string; gauge: Gauge }) {
  return (
    <details className={`outlook-gauge ${TONE[gauge.level]}`}>
      <summary><span>{title}</span><b>{gauge.level}</b><i className="outlook-bar"><i style={{ width: `${gauge.score}%` }} /></i></summary>
      {gauge.reasons.length ? <ul>{gauge.reasons.map((r, i) => <li key={i}><span>{r.text}</span><small>{r.points > 0 ? `+${r.points}` : r.points}</small></li>)}</ul> : <p className="muted small">Keine besonderen Gründe – normaler Tag.</p>}
    </details>
  );
}

function EventDialog({ date, onClose }: { date: string; onClose: () => void }) {
  const { bump } = useData();
  const toast = useToast();
  const [v, setV] = useState({ date, time: '', title: '', effect: 'more' as OutlookEffect });
  const f = useSubmit(outlookEventInput, async (d) => { await api('POST', '/restaurant/events', d); toast('Veranstaltung eingetragen'); bump(); onClose(); });
  return (
    <Dialog title="Veranstaltung eintragen" onClose={onClose}
      footer={<><Button onClick={onClose}>Abbrechen</Button><Button variant="primary" busy={f.busy} onClick={() => void f.submit(v)}>Eintragen</Button></>}>
      <form className="formgrid" onSubmit={(e) => void f.submit(v, e)} noValidate>
        <Field label="Was ist los?" wide error={f.errors.title}><input autoFocus value={v.title} maxLength={120} placeholder="z. B. Weihnachtsmarkt am Marktplatz, Konzert Stadthalle" onChange={(e) => setV({ ...v, title: e.target.value })} /></Field>
        <Field label="Datum" error={f.errors.date}><input type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} /></Field>
        <Field label="Uhrzeit (falls bekannt)" error={f.errors.time}><input type="time" value={v.time} onChange={(e) => setV({ ...v, time: e.target.value })} /></Field>
        <Field label="Wirkung auf das Restaurant" wide>
          <div className="radiolist">{OUTLOOK_EFFECTS.map((k) => <label key={k} className="check"><input type="radio" name="effect" checked={v.effect === k} onChange={() => setV({ ...v, effect: k })} /><span>{EFFECT_LABEL[k]}</span></label>)}</div>
        </Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

function SetupDialog({ onClose }: { onClose: () => void }) {
  const { bump } = useData();
  const toast = useToast();
  const { data, error } = useLoad(() => api<OutlookSettings>('GET', '/restaurant/outlook/settings'));
  const [v, setV] = useState<Record<string, string> | null>(null);
  const [link, setLink] = useState('');
  const [finding, setFinding] = useState(false);
  const cur = v ?? (data ? Object.fromEntries(Object.entries(data).map(([k, x]) => [k, x === null ? '' : String(x)])) : null);
  const f = useSubmit(outlookSettingsInput, async (d) => { await api('PUT', '/restaurant/outlook/settings', d); toast('Ausblick eingestellt'); bump(); onClose(); });
  if (!cur) return <Dialog title="Ausblick einstellen" onClose={onClose}><LoadState error={error} loading /></Dialog>;
  const set = (k: string, x: string) => setV({ ...cur, [k]: x });
  const num = (x: string) => (x.trim() === '' ? null : Number(x.replace(',', '.')));
  const save = () => void f.submit({ ...cur, lat: num(cur.lat!), lon: num(cur.lon!), lunchFrom: num(cur.lunchFrom!), lunchTo: num(cur.lunchTo!), dinnerFrom: num(cur.dinnerFrom!), dinnerTo: num(cur.dinnerTo!),
    coldC: num(cur.coldC!), coldPoints: num(cur.coldPoints!), footballLeavePoints: num(cur.footballLeavePoints!), winterSeason: cur.winterSeason === 'true' });
  const locate = async () => {
    setFinding(true);
    try { const r = await api<{ lat: number; lon: number; place: string }>('POST', '/restaurant/outlook/locate', { url: link }); setV({ ...cur, lat: String(r.lat), lon: String(r.lon), place: cur.place || r.place }); toast('Standort übernommen'); }
    catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
    setFinding(false);
  };
  return (
    <Dialog title="Ausblick einstellen" onClose={onClose} size="lg"
      footer={<><Button onClick={onClose}>Abbrechen</Button><Button variant="primary" busy={f.busy} onClick={save}>Speichern</Button></>}>
      <h3 className="first">Standort für das Wetter</h3>
      <p className="muted small">In Google Maps das Haus öffnen → „Teilen“ → „Link kopieren“ und hier einfügen. Übertragen werden später nur diese Koordinaten an den Wetterdienst – keine Gästedaten.</p>
      <div className="formgrid">
        <Field label="Google-Maps-Link" wide><div className="inlinerow"><input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://maps.app.goo.gl/…" /><Button busy={finding} disabled={link.trim().length < 10} onClick={() => void locate()}>Übernehmen</Button></div></Field>
        <Field label="Breitengrad" error={f.errors.lat}><input inputMode="decimal" value={cur.lat} onChange={(e) => set('lat', e.target.value)} /></Field>
        <Field label="Längengrad" error={f.errors.lon}><input inputMode="decimal" value={cur.lon} onChange={(e) => set('lon', e.target.value)} /></Field>
        <Field label="Ortsname (nur Anzeige)" error={f.errors.place}><input value={cur.place} onChange={(e) => set('place', e.target.value)} /></Field>
      </div>
      <h3>Essenszeiten (für das Wetter)</h3>
      <div className="formgrid cols3">
        <Field label="Mittag ab (Uhr)" error={f.errors.lunchFrom}><input inputMode="numeric" value={cur.lunchFrom} onChange={(e) => set('lunchFrom', e.target.value)} /></Field>
        <Field label="Mittag bis (Uhr)" error={f.errors.lunchTo}><input inputMode="numeric" value={cur.lunchTo} onChange={(e) => set('lunchTo', e.target.value)} /></Field>
        <span />
        <Field label="Abend ab (Uhr)" error={f.errors.dinnerFrom}><input inputMode="numeric" value={cur.dinnerFrom} onChange={(e) => set('dinnerFrom', e.target.value)} /></Field>
        <Field label="Abend bis (Uhr)" error={f.errors.dinnerTo}><input inputMode="numeric" value={cur.dinnerTo} onChange={(e) => set('dinnerTo', e.target.value)} /></Field>
      </div>
      <h3>Erfahrungswerte des Hauses</h3>
      <div className="formgrid cols3">
        <Field label="Mehr Gäste ab (°C und kälter)" error={f.errors.coldC} hint="z. B. 10"><input inputMode="numeric" value={cur.coldC} onChange={(e) => set('coldC', e.target.value)} /></Field>
        <Field label="… wie stark (Punkte)" error={f.errors.coldPoints} hint="0 = gar nicht, 15 = deutlich, 30 = sehr stark"><input inputMode="numeric" value={cur.coldPoints} onChange={(e) => set('coldPoints', e.target.value)} /></Field>
        <Field label="Fußball: Gäste gehen früher (Punkte)" error={f.errors.footballLeavePoints} hint="35 = fast immer"><input inputMode="numeric" value={cur.footballLeavePoints} onChange={(e) => set('footballLeavePoints', e.target.value)} /></Field>
        <label className="check wide"><input type="checkbox" checked={cur.winterSeason === 'true'} onChange={(e) => set('winterSeason', String(e.target.checked))} /><span>Wintersaison (November bis März) bringt mehr Gäste<small>für ein Haus mit deftiger Winterküche</small></span></label>
      </div>
      <h3>Fußball</h3>
      <div className="formgrid">
        <Field label="Ligen" error={f.errors.leagues} hint="Kürzel bei OpenLigaDB: bl1 = 1. Bundesliga, bl2 = 2. Bundesliga, dfb = DFB-Pokal. Leer lassen = kein Fußball."><input value={cur.leagues} onChange={(e) => set('leagues', e.target.value)} /></Field>
        <Field label="Verein, der besonders zählt" error={f.errors.favoriteTeam} hint="Teil des Namens genügt, z. B. „Schalke“"><input value={cur.favoriteTeam} onChange={(e) => set('favoriteTeam', e.target.value)} /></Field>
      </div>
      <p className="muted small">Länderspiele, Champions League und örtliche Feste sind nicht automatisch dabei – dafür „+ Veranstaltung“ nutzen.</p>
    </Dialog>
  );
}
