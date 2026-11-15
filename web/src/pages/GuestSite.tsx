import { useEffect, useMemo, useState } from 'react';
import { addDays, formatMoney, todayBerlin } from '../../../src/shared/hotel.js';
import { webRequestInput } from '../../../src/shared/inbox.js';
import type { SiteAvailability, SiteCategory, SitePublic } from '../../../src/shared/site.js';
import { ApiFailure, api } from '../api.ts';
import { Button, Field, LoadState, useLoad, useSubmit } from '../ui.tsx';

const deDay = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
const persons = (n: number) => `${n} ${n === 1 ? 'Person' : 'Personen'}`;

/**
 * Gästeseite: öffentliche Seite des Hauses – ohne Anmeldung. Zimmer ansehen, Verfügbarkeit für einen Zeitraum prüfen,
 * unverbindlich anfragen. Es wird nichts gebucht und nichts bezahlt; die Anfrage landet im E-Mail-Posteingang des Hauses.
 */
export function GuestSite({ staffLink = false }: { staffLink?: boolean }) {
  const { data, error } = useLoad(() => api<SitePublic>('GET', '/public/site'));
  const today = todayBerlin();
  const [q, setQ] = useState({ from: addDays(today, 1), to: addDays(today, 3), adults: '2', children: '0' });
  const [avail, setAvail] = useState<SiteAvailability | null>(null);
  const [searched, setSearched] = useState<typeof q | null>(null);
  const [searchErr, setSearchErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState<SiteCategory | null>(null);
  useEffect(() => { if (data?.hotel.name) document.title = data.hotel.name; }, [data]);
  if (!data) return <div className="site"><div className="site-wrap"><LoadState error={error} loading /></div></div>;
  if (!data.enabled && !data.preview) return (
    <div className="site"><div className="site-wrap site-off"><h1>{data.hotel.name}</h1><p>Diese Seite ist derzeit nicht verfügbar.</p>{staffLink && <a href="/anmelden">Anmeldung für Mitarbeiter</a>}</div></div>
  );
  const search = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setBusy(true); setSearchErr({});
    try {
      const r = await api<SiteAvailability>('GET', `/public/site/availability?${new URLSearchParams({ from: q.from, to: q.to, adults: q.adults || '1', children: q.children || '0' })}`);
      setAvail(r); setSearched(q);
      setTimeout(() => document.getElementById('zimmer')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    } catch (err) { setSearchErr(err instanceof ApiFailure && Object.keys(err.fields).length ? err.fields : { form: err instanceof Error ? err.message : 'Fehler' }); }
    setBusy(false);
  };
  const h = data.hotel;
  const address = [h.street, `${h.zip} ${h.city}`.trim()].filter(Boolean).join(', ');
  return (
    <div className="site">
      {data.preview && <div className="site-preview">Vorschau – die Seite ist noch nicht freigeschaltet. Nur Sie als Administrator sehen sie.</div>}
      <header className="site-hero">
        <div className="site-wrap">
          <div className="site-brand">{data.hasLogo ? <img src="/api/v1/public/site/logo" alt="" /> : <span className="mark">{h.name.slice(0, 1) || 'H'}</span>}<span>{h.name}</span></div>
          <h1>{data.headline || `Willkommen im ${h.name}`}</h1>
          {data.intro && <p className="site-intro">{data.intro}</p>}
          <form className="site-search" onSubmit={(e) => void search(e)} noValidate>
            <Field label="Anreise" error={searchErr.from}><input type="date" min={today} value={q.from} onChange={(e) => setQ({ ...q, from: e.target.value, to: q.to <= e.target.value ? addDays(e.target.value, 1) : q.to })} /></Field>
            <Field label="Abreise" error={searchErr.to}><input type="date" min={addDays(q.from || today, 1)} value={q.to} onChange={(e) => setQ({ ...q, to: e.target.value })} /></Field>
            <Field label="Erwachsene" error={searchErr.adults}><select value={q.adults} onChange={(e) => setQ({ ...q, adults: e.target.value })}>{[1, 2, 3, 4, 5, 6].map((n) => <option key={n}>{n}</option>)}</select></Field>
            <Field label="Kinder" error={searchErr.children}><select value={q.children} onChange={(e) => setQ({ ...q, children: e.target.value })}>{[0, 1, 2, 3, 4].map((n) => <option key={n}>{n}</option>)}</select></Field>
            <Button type="submit" variant="primary" busy={busy}>Verfügbarkeit prüfen</Button>
          </form>
          {searchErr.form && <p className="notice danger">{searchErr.form}</p>}
        </div>
      </header>

      <main className="site-wrap">
        {data.highlights.length > 0 && <ul className="site-highlights">{data.highlights.map((x) => <li key={x}>{x}</li>)}</ul>}
        <section id="zimmer">
          <h2 className="site-h2">{searched ? `Ihr Aufenthalt: ${deDay(searched.from)} – ${deDay(searched.to)}` : 'Unsere Zimmer'}</h2>
          {searched && avail && <p className="muted">{avail.nights} {avail.nights === 1 ? 'Nacht' : 'Nächte'} · {persons(Number(searched.adults) + Number(searched.children))}{data.showPrices ? ' · Preise inklusive Mehrwertsteuer' : ''}</p>}
          {data.categories.length === 0 && <p className="notice">Hier erscheinen bald unsere Zimmer.</p>}
          <div className="site-rooms">
            {data.categories.map((c) => {
              const a = avail?.categories.find((x) => x.id === c.id);
              return (
                <article key={c.id} className={`site-room ${a && !a.available ? 'off' : ''}`}>
                  <div className="site-photo">{c.hasPhoto ? <img src={`/api/v1/public/site/photo/${c.id}?v=${c.photoVersion}`} alt={c.name} loading="lazy" /> : <span aria-hidden>{c.name.slice(0, 1)}</span>}</div>
                  <div className="site-room-body">
                    <h3>{c.name}</h3>
                    <p className="muted small">bis {persons(c.maxPersons)}</p>
                    {c.text && <p className="site-room-text">{c.text}</p>}
                    <div className="site-room-foot">
                      {!a ? (c.fromPriceCents != null ? <span className="site-price"><small>ab</small> {formatMoney(c.fromPriceCents)} <small>/ Nacht</small></span> : <span />)
                        : a.available ? (a.totalCents != null ? <span className="site-price">{formatMoney(a.totalCents)} <small>für {avail!.nights} {avail!.nights === 1 ? 'Nacht' : 'Nächte'}</small></span> : <span className="site-ok">frei</span>)
                        : <span className="site-none">{Number(searched!.adults) + Number(searched!.children) > c.maxPersons ? `für ${persons(Number(searched!.adults) + Number(searched!.children))} zu klein` : 'in diesem Zeitraum belegt'}</span>}
                      {data.requestEnabled && (!a || a.available) && <Button variant={a ? 'primary' : 'default'} onClick={() => setPick(c)}>{a ? 'Unverbindlich anfragen' : 'Anfragen'}</Button>}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
          {data.categories.length > 0 && !avail && <p className="muted small">Für Ihre Reisedaten oben „Verfügbarkeit prüfen“ wählen – dann sehen Sie, was frei ist und was der Aufenthalt kostet.</p>}
        </section>

        {(pick || (data.requestEnabled && data.categories.length === 0)) && (
          <Request site={data} category={pick} stay={searched ?? q} onClose={() => setPick(null)} />
        )}

        <section className="site-contact">
          <div><h2 className="site-h2">Kontakt</h2><p><b>{h.name}</b>{address && <><br />{address}</>}</p></div>
          <div><p>{h.phone && <>Telefon <a href={`tel:${h.phone.replace(/[^\d+]/g, '')}`}>{h.phone}</a><br /></>}{h.email && <>E-Mail <a href={`mailto:${h.email}`}>{h.email}</a><br /></>}{h.website && <a href={/^https?:/.test(h.website) ? h.website : `https://${h.website}`} rel="noopener">{h.website}</a>}</p></div>
        </section>
      </main>
      <footer className="site-foot"><div className="site-wrap">
        <span>© {new Date().getFullYear()} {h.name}</span>
        <nav>{data.imprintUrl && <a href={data.imprintUrl} rel="noopener">Impressum</a>}{data.privacyUrl && <a href={data.privacyUrl} rel="noopener">Datenschutz</a>}{staffLink && <a href="/anmelden">Mitarbeiter</a>}</nav>
      </div></footer>
    </div>
  );
}

function Request({ site, category, stay, onClose }: { site: SitePublic; category: SiteCategory | null; stay: { from: string; to: string; adults: string; children: string }; onClose: () => void }) {
  const [v, setV] = useState({ name: '', email: '', phone: '', message: '', consent: false, website: '' });
  const [done, setDone] = useState(false);
  const f = useSubmit(webRequestInput, async (d) => { await api('POST', '/public/booking-request', d); setDone(true); });
  useMemo(() => setDone(false), [category?.id]);
  useEffect(() => { document.getElementById('anfrage')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [category?.id]);
  const send = (e: React.FormEvent) => void f.submit({ ...v, from: stay.from, to: stay.to, adults: Number(stay.adults), children: Number(stay.children) || 0, category: category?.name ?? '' }, e);
  return (
    <section id="anfrage" className="site-request">
      <div className="cardhead"><h2 className="site-h2">Unverbindliche Anfrage{category ? `: ${category.name}` : ''}</h2>{category && <button type="button" className="iconbtn" aria-label="Schließen" onClick={onClose}>✕</button>}</div>
      {done ? <p className="notice">Vielen Dank – Ihre Anfrage ist bei uns angekommen. Wir melden uns so bald wie möglich. Die Anfrage ist noch keine Buchung.</p> : (
        <form onSubmit={send} noValidate>
          <p className="muted">{deDay(stay.from)} – {deDay(stay.to)} · {persons(Number(stay.adults) + Number(stay.children))}{(f.errors.from || f.errors.to) && <span className="error"> – {f.errors.from || f.errors.to}</span>}</p>
          <div className="formgrid">
            <Field label="Ihr Name" error={f.errors.name}><input autoComplete="name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
            <Field label="E-Mail" error={f.errors.email}><input type="email" autoComplete="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></Field>
            <Field label="Telefon (freiwillig)" error={f.errors.phone}><input type="tel" autoComplete="tel" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} /></Field>
            <Field label="Nachricht (freiwillig)" error={f.errors.message} wide><textarea rows={3} value={v.message} onChange={(e) => setV({ ...v, message: e.target.value })} /></Field>
            <input className="hp" tabIndex={-1} autoComplete="off" aria-hidden value={v.website} onChange={(e) => setV({ ...v, website: e.target.value })} />
            <label className="check wide"><input type="checkbox" checked={v.consent} onChange={(e) => setV({ ...v, consent: e.target.checked })} />
              <span>Ich habe den Hinweis zum Datenschutz gelesen.{site.privacyText && <small>{site.privacyText}</small>}{site.privacyUrl && <small><a href={site.privacyUrl} rel="noopener">Datenschutzerklärung</a></small>}{f.errors.consent && <span className="error" role="alert">{f.errors.consent}</span>}</span></label>
          </div>
          <div className="formactions"><Button type="submit" variant="primary" busy={f.busy}>Anfrage senden</Button></div>
          <p className="muted small">Mit dem Absenden fragen Sie unverbindlich an. Eine Buchung kommt erst zustande, wenn wir sie Ihnen bestätigen.</p>
        </form>
      )}
    </section>
  );
}
