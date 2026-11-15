import { useEffect, useRef, useState, type ReactNode } from 'react';
import { addDays, formatMoney, todayBerlin } from '../../../src/shared/hotel.js';
import type { SiteAvailability, SiteCategory, SitePublic, SiteSection } from '../../../src/shared/site.js';
import { ApiFailure, api } from '../api.ts';
import { LoadState, useLoad } from '../ui.tsx';

const deDay = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
const persons = (n: number) => `${n} ${n === 1 ? 'Person' : 'Personen'}`;
const tel = (p: string) => `tel:${p.replace(/[^\d+]/g, '').replace(/^0(?=[1-9])/, '+49')}`;
const mail = (to: string, subject: string) => `mailto:${to}?subject=${encodeURIComponent(subject)}`;

/** Überschrift mit zweiter, kursiver Zeile – wie in der Gestaltungsvorlage */
const Title = ({ s, as: As = 'h2', id }: { s: Pick<SiteSection, 'title' | 'titleEm'>; as?: 'h1' | 'h2' | 'h3'; id?: string }) => (
  <As id={id}>{s.title}{s.title && s.titleEm && <br />}{s.titleEm && <em>{s.titleEm}</em>}</As>
);

/** Bild aus den Einstellungen – ohne Bild ein ruhiger Platzhalter mit Anfangsbuchstaben */
function Pic({ src, alt, letter, className = '' }: { src: string | null; alt: string; letter: string; className?: string }) {
  return src ? <figure className={`gs-pic ${className}`}><img src={src} alt={alt} loading="lazy" decoding="async" /></figure>
    : <figure className={`gs-pic empty ${className}`} aria-hidden><span>{letter}</span></figure>;
}

/** Bereiche blenden beim Scrollen weich ein */
function Reveal({ children, className = '', id, as: As = 'section', label }: { children: ReactNode; className?: string; id?: string; as?: 'section' | 'div'; label?: string }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !('IntersectionObserver' in window)) { el?.classList.add('in'); return; }
    const o = new IntersectionObserver(([e]) => { if (e?.isIntersecting) { el.classList.add('in'); o.disconnect(); } }, { threshold: 0.12 });
    o.observe(el);
    return () => o.disconnect();
  }, []);
  return <As ref={ref as never} id={id} aria-label={label} className={`gs-reveal ${className}`}>{children}</As>;
}

/**
 * Gästeseite: öffentliche Seite des Hauses – ohne Anmeldung. Zimmer ansehen, Verfügbarkeit prüfen, unverbindlich anfragen.
 * Es wird nichts gebucht und nichts bezahlt; Anfragen landen im E-Mail-Posteingang des Hauses.
 */
export function GuestSite({ staffLink = false }: { staffLink?: boolean }) {
  const { data, error } = useLoad(() => api<SitePublic>('GET', '/public/site'));
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => { if (data?.hotel.name) document.title = data.hotel.name; }, [data]);
  if (!data) return <div className="gs"><div className="gs-wrap gs-off"><LoadState error={error} loading /></div></div>;
  if (!data.enabled && !data.preview) return (
    <div className="gs"><div className="gs-wrap gs-off"><h1>{data.hotel.name}</h1><p>Diese Seite ist derzeit nicht verfügbar.</p>{staffLink && <p><a className="gs-link" href="/anmelden">Anmeldung für Mitarbeiter</a></p>}</div></div>
  );
  const h = data.hotel, S = data.sections;
  const img = (k: keyof SitePublic['images']) => (data.images[k] ? `/api/v1/public/site/image/${k}?v=${data.images[k]}` : null);
  const letter = h.name.replace(/^(Hotel|Restaurant|Gasthof|Gasthaus)\s*(&|und)?\s*(Restaurant|Hotel)?\s*/i, '').slice(0, 1) || h.name.slice(0, 1) || 'H';
  const brand = h.name.replace(/^(Hotel|Restaurant)\s*(&|und)\s*(Restaurant|Hotel)\s+/i, '') || h.name;
  const hotelOn = S.hotel.show && data.categories.length > 0;
  const nav: [string, string, boolean][] = [
    ['gs-start', 'Das Haus', true], ['gs-restaurant', 'Restaurant', S.restaurant.show], ['gs-hotel', 'Hotel & Zimmer', hotelOn], ['gs-feiern', 'Feiern & Tagen', S.events.show],
    ['gs-gutscheine', 'Gutscheine', S.vouchers.show && !!h.email], ['gs-kontakt', 'Kontakt', S.contact.show],
  ];
  const address = [h.street, `${h.zip} ${h.city}`.trim()].filter(Boolean);
  const callBtn = (label: string, cls = '') => h.phone ? <a className={`gs-btn ${cls}`} href={tel(h.phone)}>{label}</a> : h.email ? <a className={`gs-btn ${cls}`} href={mail(h.email, 'Tischreservierung')}>{label.replace('telefonisch', 'per E-Mail')}</a> : null;
  const go = (id: string) => { setMenuOpen(false); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  return (
    <div className="gs">
      {data.preview && <div className="gs-preview">Vorschau – die Seite ist noch nicht freigeschaltet. Nur Sie als Administrator sehen sie.</div>}
      <header className="gs-header">
        <div className="gs-wrap">
          <a className="gs-brand" href="#gs-start" onClick={(e) => { e.preventDefault(); go('gs-start'); }}>
            {data.hasLogo && <img src="/api/v1/public/site/logo" alt="" />}
            <span className="gs-brand-name">{brand}</span>{data.brandSubtitle && <span className="gs-brand-sub">{data.brandSubtitle}</span>}
          </a>
          <button type="button" className="gs-menu" aria-expanded={menuOpen} aria-controls="gs-nav" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? 'Menü schließen' : 'Menü öffnen'}</button>
          <nav id="gs-nav" className={`gs-nav ${menuOpen ? 'open' : ''}`} aria-label="Hauptnavigation">
            {nav.filter(([, , on]) => on).map(([id, label]) => <a key={id} href={`#${id}`} onClick={(e) => { e.preventDefault(); go(id); }}>{label}</a>)}
          </nav>
        </div>
      </header>

      <main>
        <section id="gs-start" className={`gs-hero ${img('hero') ? '' : 'noimg'}`} aria-labelledby="gs-h1">
          {img('hero') && <img src={img('hero')!} alt="" fetchPriority="high" />}
          <div className="gs-hero-in">
            <span className="gs-mono" aria-hidden>{letter}</span>
            {data.heroKicker && <span className="gs-kicker">{data.heroKicker}</span>}
            <Title as="h1" id="gs-h1" s={{ title: data.headline || `Willkommen im ${h.name}`, titleEm: data.headlineEm }} />
            {data.heroText && <p>{data.heroText}</p>}
            <div className="gs-actions">
              {S.reservation.show && callBtn('Tisch telefonisch reservieren', 'light')}
              {hotelOn && <a className="gs-btn outline" href="#gs-hotel" onClick={(e) => { e.preventDefault(); go('gs-hotel'); }}>Zimmer anfragen</a>}
            </div>
          </div>
        </section>

        {(data.introTitle || data.intro) && (
          <Reveal className="gs-section"><div className="gs-wrap gs-intro">
            <span className="gs-kicker">{data.introKicker || h.name}</span>
            <Title s={{ title: data.introTitle, titleEm: data.introTitleEm }} />
            {data.intro && <p>{data.intro}</p>}
            {data.highlights.length > 0 && <ul className="gs-highlights">{data.highlights.map((x) => <li key={x}>{x}</li>)}</ul>}
            <span className="gs-divider" aria-hidden />
          </div></Reveal>
        )}

        {S.restaurant.show && (
          <Reveal id="gs-restaurant" className="gs-section"><div className="gs-wrap gs-grid">
            <Pic src={img('restaurant')} alt={`Restaurant – ${h.name}`} letter={letter} />
            <div className="gs-copy">
              <span className="gs-kicker">{S.restaurant.kicker}</span><Title s={S.restaurant} />{S.restaurant.text && <p>{S.restaurant.text}</p>}
              <div className="gs-actions">{S.reservation.show && callBtn('Tisch telefonisch reservieren')}{S.menu.show && <a className="gs-link" href="#gs-karte" onClick={(e) => { e.preventDefault(); go('gs-karte'); }}>Zur Speisekarte</a>}</div>
              {S.restaurant.note && <p className="gs-note">{S.restaurant.note}</p>}
            </div>
          </div></Reveal>
        )}

        {hotelOn && <Hotel data={data} img={img('hotel')} letter={letter} />}

        {S.menu.show && (
          <Reveal id="gs-karte" className="gs-section"><div className="gs-wrap">
            <div className="gs-head"><div><span className="gs-kicker">{S.menu.kicker}</span><Title s={S.menu} /></div>{S.menu.note && <p>{S.menu.note}</p>}</div>
            <div className="gs-card"><h3>Vorfreude auf Ihren nächsten Besuch.</h3>{S.menu.text && <p>{S.menu.text}</p>}<div className="gs-actions">{callBtn('Aktuelle Speisekarte erfragen')}</div></div>
          </div></Reveal>
        )}

        {S.events.show && (
          <Reveal id="gs-feiern" className="gs-section gs-soft"><div className="gs-wrap">
            <div className="gs-head"><div><span className="gs-kicker">{S.events.kicker}</span><Title s={S.events} /></div>{S.events.text && <p>{S.events.text}</p>}</div>
            <Pic src={img('events')} alt={`Feiern – ${h.name}`} letter={letter} className="gs-events-pic" />
            {data.eventTypes.length > 0 && <div className="gs-types" style={{ ['--n' as string]: Math.min(4, data.eventTypes.length) }}>{data.eventTypes.map((x) => <span key={x}>{x}</span>)}</div>}
            {h.email && <div className="gs-actions"><a className="gs-btn" href={mail(h.email, 'Unverbindliche Veranstaltungsanfrage')}>Ihre Veranstaltung anfragen</a></div>}
            {S.events.note && <p className="gs-note">{S.events.note}</p>}
          </div></Reveal>
        )}

        {S.vouchers.show && h.email && (
          <Reveal id="gs-gutscheine" className="gs-section"><div className="gs-wrap gs-grid">
            <div className="gs-gift"><span className="gs-kicker">{h.name}</span><h3>Gute Zeit.<br /><em>Verschenkt.</em></h3><small>Gutschein auf Anfrage</small></div>
            <div className="gs-copy">
              <span className="gs-kicker">{S.vouchers.kicker}</span><Title s={S.vouchers} />{S.vouchers.text && <p>{S.vouchers.text}</p>}
              <div className="gs-actions"><a className="gs-btn" href={mail(h.email, 'Unverbindliche Gutscheinanfrage')}>Gutschein per E-Mail anfragen</a></div>
              {S.vouchers.note && <p className="gs-note">{S.vouchers.note}</p>}
            </div>
          </div></Reveal>
        )}

        {S.reservation.show && (h.phone || h.email) && (
          <Reveal id="gs-reservierung" className="gs-section gs-dark"><div className="gs-wrap gs-grid">
            <div className="gs-copy"><span className="gs-kicker">{S.reservation.kicker}</span><Title s={S.reservation} />{S.reservation.text && <p>{S.reservation.text}</p>}</div>
            <div>
              {h.phone ? <a className="gs-phone" href={tel(h.phone)}>{h.phone}</a> : <a className="gs-phone" href={mail(h.email, 'Tischreservierung')}>{h.email}</a>}
              {callBtn('Jetzt anrufen', 'light')}
              {S.reservation.note && <p className="gs-note">{S.reservation.note}</p>}
            </div>
          </div></Reveal>
        )}

        {S.contact.show && (
          <Reveal id="gs-kontakt" className="gs-section"><div className="gs-wrap gs-grid">
            <div className="gs-copy gs-contact">
              <span className="gs-kicker">{S.contact.kicker}</span><Title s={S.contact} />{S.contact.text && <p>{S.contact.text}</p>}
              <p style={{ marginTop: 24 }}>{h.name}{address.map((l) => <span key={l}><br />{l}</span>)}</p>
              <p>{h.phone && <><a href={tel(h.phone)}>{h.phone}</a><br /></>}{h.email && <a href={`mailto:${h.email}`}>{h.email}</a>}</p>
              {data.hours.length > 0 && <div className="gs-hours">{data.hours.map((x) => <div key={x.label}><span>{x.label}</span><span>{x.value}</span></div>)}</div>}
              {data.hoursNote && <p className="gs-note">{data.hoursNote}</p>}
            </div>
            {address.length > 0 && (
              <div className="gs-route">
                <span className="gs-kicker">Willkommen{h.city ? ` in ${h.city}` : ''}</span>
                <h3>Zu Gast im<br />{brand}.</h3>
                <p>{address.map((l, i) => <span key={l}>{i > 0 && <br />}{l}</span>)}</p>
                {data.routeLink && <><div className="gs-actions"><a className="gs-btn" href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address.join(' '))}`} target="_blank" rel="noopener noreferrer">Route planen – Google Maps</a></div>
                  <p className="gs-note">Öffnet einen neuen Tab. Erst beim Anklicken wird der externe Kartendienst aufgerufen.</p></>}
              </div>
            )}
          </div></Reveal>
        )}

        {S.faq.show && data.faq.length > 0 && (
          <Reveal className="gs-section gs-soft"><div className="gs-wrap gs-grid" style={{ alignItems: 'start' }}>
            <div><span className="gs-kicker">{S.faq.kicker}</span><Title s={S.faq} /></div>
            <div className="gs-faq">{data.faq.map((f) => <details key={f.q}><summary>{f.q}</summary><p>{f.a}</p></details>)}</div>
          </div></Reveal>
        )}
      </main>

      <footer className="gs-foot"><div className="gs-wrap">
        <div className="gs-foot-grid">
          <div><h3>{brand}</h3><p>{data.brandSubtitle || h.name}</p></div>
          <nav className="gs-foot-links" aria-label="Weitere Bereiche">{nav.filter(([id, , on]) => on && id !== 'gs-start').map(([id, label]) => <a key={id} href={`#${id}`} onClick={(e) => { e.preventDefault(); go(id); }}>{label}</a>)}</nav>
          <div className="gs-foot-links">{h.phone && <a href={tel(h.phone)}>{h.phone}</a>}{h.email && <a href={`mailto:${h.email}`}>{h.email}</a>}{address.length > 0 && <p>{address.map((l, i) => <span key={l}>{i > 0 && <br />}{l}</span>)}</p>}</div>
        </div>
        <div className="gs-foot-bottom">
          <span>© {new Date().getFullYear()} {h.name}</span>
          <nav>{data.imprintUrl && <a href={data.imprintUrl} rel="noopener">Impressum</a>}{data.privacyUrl && <a href={data.privacyUrl} rel="noopener">Datenschutz</a>}{staffLink && <a href="/anmelden">Mitarbeiter</a>}</nav>
        </div>
      </div></footer>
    </div>
  );
}

/** Hotel: Text und Bild, darunter die Zimmer mit Verfügbarkeit und die unverbindliche Anfrage. */
function Hotel({ data, img, letter }: { data: SitePublic; img: string | null; letter: string }) {
  const S = data.sections.hotel;
  const today = todayBerlin();
  const [q, setQ] = useState({ from: addDays(today, 1), to: addDays(today, 3), adults: '2', children: '0' });
  const [avail, setAvail] = useState<SiteAvailability | null>(null);
  const [searched, setSearched] = useState<typeof q | null>(null);
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState<SiteCategory | null | undefined>(undefined);
  const search = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr({});
    try {
      setAvail(await api<SiteAvailability>('GET', `/public/site/availability?${new URLSearchParams({ from: q.from, to: q.to, adults: q.adults, children: q.children })}`));
      setSearched(q);
    } catch (x) { setErr(x instanceof ApiFailure && Object.keys(x.fields).length ? x.fields : { form: x instanceof Error ? x.message : 'Fehler' }); }
    setBusy(false);
  };
  const ask = (c: SiteCategory | null) => { setPick(c); setTimeout(() => document.getElementById('gs-anfrage')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60); };
  const n = searched ? Number(searched.adults) + Number(searched.children) : 0;
  return (
    <Reveal id="gs-hotel" className="gs-section gs-soft"><div className="gs-wrap">
      <div className="gs-grid">
        <div className="gs-copy">
          <span className="gs-kicker">{S.kicker}</span><Title s={S} />{S.text && <p>{S.text}</p>}
          <div className="gs-actions">{data.requestEnabled && <button type="button" className="gs-btn" onClick={() => ask(null)}>Zimmer unverbindlich anfragen</button>}</div>
          {S.note && <p className="gs-note">{S.note}</p>}
        </div>
        <Pic src={img} alt="Zimmer" letter={letter} className="first" />
      </div>

      {data.showAvailability && (
        <form className="gs-search" onSubmit={(e) => void search(e)} noValidate aria-label="Verfügbarkeit prüfen">
          <label>Anreise<input type="date" min={today} value={q.from} onChange={(e) => setQ({ ...q, from: e.target.value, to: q.to <= e.target.value ? addDays(e.target.value, 1) : q.to })} />{err.from && <span className="gs-err">{err.from}</span>}</label>
          <label>Abreise<input type="date" min={addDays(q.from || today, 1)} value={q.to} onChange={(e) => setQ({ ...q, to: e.target.value })} />{err.to && <span className="gs-err">{err.to}</span>}</label>
          <label>Erwachsene<select value={q.adults} onChange={(e) => setQ({ ...q, adults: e.target.value })}>{[1, 2, 3, 4, 5, 6].map((x) => <option key={x}>{x}</option>)}</select></label>
          <label>Kinder<select value={q.children} onChange={(e) => setQ({ ...q, children: e.target.value })}>{[0, 1, 2, 3, 4].map((x) => <option key={x}>{x}</option>)}</select></label>
          <button type="submit" className="gs-btn" disabled={busy}>{busy ? 'Prüfe …' : 'Verfügbarkeit prüfen'}</button>
          {err.form && <span className="gs-err" style={{ gridColumn: '1 / -1' }}>{err.form}</span>}
        </form>
      )}
      {searched && avail && <p style={{ marginBottom: 18 }}><b>{deDay(searched.from)} – {deDay(searched.to)}</b> · {avail.nights} {avail.nights === 1 ? 'Nacht' : 'Nächte'} · {persons(n)}{data.showPrices ? ' · Preise inkl. Mehrwertsteuer' : ''}</p>}

      <div className="gs-rooms" style={{ marginTop: data.showAvailability ? 0 : 40 }}>
        {data.categories.map((c) => {
          const a = avail?.categories.find((x) => x.id === c.id);
          return (
            <article key={c.id} className={`gs-room ${a && !a.available ? 'off' : ''}`}>
              <Pic src={c.hasPhoto ? `/api/v1/public/site/photo/${c.id}?v=${c.photoVersion}` : null} alt={c.name} letter={c.name.slice(0, 1)} />
              <div className="gs-room-body">
                <h3>{c.name}</h3>
                <span className="gs-room-meta">bis {persons(c.maxPersons)}</span>
                {c.text && <p>{c.text}</p>}
                <div className="gs-room-foot">
                  {!a ? (c.fromPriceCents != null ? <span className="gs-price"><small>ab </small>{formatMoney(c.fromPriceCents)}<small> / Nacht</small></span> : <span />)
                    : a.available ? (a.totalCents != null ? <span className="gs-price">{formatMoney(a.totalCents)}<small> für {avail!.nights} {avail!.nights === 1 ? 'Nacht' : 'Nächte'}</small></span> : <span className="gs-price">frei</span>)
                    : <span className="gs-none">{n > c.maxPersons ? `für ${persons(n)} zu klein` : 'in diesem Zeitraum belegt'}</span>}
                  {data.requestEnabled && (!a || a.available) && <button type="button" className="gs-btn" onClick={() => ask(c)}>Anfragen</button>}
                </div>
              </div>
            </article>
          );
        })}
      </div>
      {pick !== undefined && data.requestEnabled && <Request site={data} category={pick} stay={searched ?? q} onClose={() => setPick(undefined)} />}
    </div></Reveal>
  );
}

function Request({ site, category, stay, onClose }: { site: SitePublic; category: SiteCategory | null; stay: { from: string; to: string; adults: string; children: string }; onClose: () => void }) {
  const [v, setV] = useState({ ...stay, category: category?.name ?? '', name: '', email: '', phone: '', message: '', consent: false, website: '' });
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => { setV((x) => ({ ...x, category: category?.name ?? x.category })); setDone(false); }, [category]);
  const send = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr({});
    try { await api('POST', '/public/booking-request', { ...v, adults: Number(v.adults), children: Number(v.children) || 0 }); setDone(true); }
    catch (x) { setErr(x instanceof ApiFailure && Object.keys(x.fields).length ? x.fields : { form: x instanceof Error ? x.message : 'Fehler' }); }
    setBusy(false);
  };
  const field = (k: 'from' | 'to' | 'name' | 'email' | 'phone', label: string, type = 'text', cls = '', auto?: string) => (
    <label className={`gs-f ${cls}`}>{label}<input type={type} autoComplete={auto} value={v[k]} min={type === 'date' ? todayBerlin() : undefined} onChange={(e) => setV({ ...v, [k]: e.target.value })} />{err[k] && <span className="gs-err">{err[k]}</span>}</label>
  );
  return (
    <div id="gs-anfrage" className="gs-request">
      <span className="gs-kicker">Unverbindliche Anfrage</span>
      {done ? <><p className="gs-thanks">Vielen Dank – Ihre Anfrage ist bei uns angekommen.</p><p>Wir melden uns so bald wie möglich bei Ihnen. Die Anfrage ist noch keine Buchung.</p><div className="gs-actions"><button type="button" className="gs-link" style={{ background: 'none', border: 0, cursor: 'pointer', borderBottom: '1px solid' }} onClick={onClose}>Schließen</button></div></> : (
        <form onSubmit={(e) => void send(e)} noValidate>
          <h3>{category ? category.name : 'Ihr Aufenthalt'}</h3>
          <div className="gs-form">
            {field('from', 'Anreise', 'date')}{field('to', 'Abreise', 'date')}
            <label className="gs-f">Erwachsene<select value={v.adults} onChange={(e) => setV({ ...v, adults: e.target.value })}>{[1, 2, 3, 4, 5, 6, 7, 8].map((x) => <option key={x}>{x}</option>)}</select></label>
            <label className="gs-f">Kinder<select value={v.children} onChange={(e) => setV({ ...v, children: e.target.value })}>{[0, 1, 2, 3, 4, 5].map((x) => <option key={x}>{x}</option>)}</select></label>
            <label className="gs-f wide">Zimmerwunsch<select value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })}><option value="">egal / bitte beraten</option>{site.categories.map((c) => <option key={c.id}>{c.name}</option>)}</select></label>
            {field('name', 'Ihr Name', 'text', 'wide', 'name')}{field('email', 'E-Mail', 'email', 'wide', 'email')}{field('phone', 'Telefon (freiwillig)', 'tel', 'wide', 'tel')}
            <label className="gs-f full">Nachricht (freiwillig)<textarea rows={3} value={v.message} onChange={(e) => setV({ ...v, message: e.target.value })} /></label>
            <input className="hp" tabIndex={-1} autoComplete="off" aria-hidden value={v.website} onChange={(e) => setV({ ...v, website: e.target.value })} />
            <label className="gs-check full"><input type="checkbox" checked={v.consent} onChange={(e) => setV({ ...v, consent: e.target.checked })} />
              <span>Ich habe den Hinweis zum Datenschutz gelesen.{site.privacyText && <><br /><small>{site.privacyText}</small></>}{site.privacyUrl && <> <a className="gs-link" href={site.privacyUrl} rel="noopener">Datenschutzerklärung</a></>}{err.consent && <><br /><span className="gs-err">{err.consent}</span></>}</span></label>
          </div>
          {err.form && <p className="gs-err">{err.form}</p>}
          <div className="gs-actions"><button type="submit" className="gs-btn" disabled={busy}>{busy ? 'Wird gesendet …' : 'Anfrage senden'}</button><button type="button" className="gs-link" style={{ background: 'none', border: 0, borderBottom: '1px solid', cursor: 'pointer' }} onClick={onClose}>Abbrechen</button></div>
          <p className="gs-note">Mit dem Absenden fragen Sie unverbindlich an. Eine Buchung kommt erst zustande, wenn wir sie Ihnen bestätigen.</p>
        </form>
      )}
    </div>
  );
}
