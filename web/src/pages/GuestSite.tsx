import { useEffect, useRef, useState, type ReactNode } from 'react';
import { addDays, formatMoney, todayBerlin } from '../../../src/shared/hotel.js';
import { REQUEST_LABEL, REQUEST_TYPES, tableTimes, type RequestType, type SiteAvailability, type SiteCategory, type SitePublic, type SiteSection } from '../../../src/shared/site.js';
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
  const [want, setWant] = useState<Want | null>(null);
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
    ['gs-gutscheine', 'Gutscheine', S.vouchers.show && (!!h.email || data.requestEnabled)], ['gs-kontakt', 'Kontakt', S.contact.show], ['gs-anfrage', 'Anfrage', data.requestEnabled],
  ];
  const address = [h.street, `${h.zip} ${h.city}`.trim()].filter(Boolean);
  const callBtn = (label: string, cls = '') => h.phone ? <a className={`gs-btn ${cls}`} href={tel(h.phone)}>{label}</a> : h.email ? <a className={`gs-btn ${cls}`} href={mail(h.email, 'Tischreservierung')}>{label.replace('telefonisch', 'per E-Mail')}</a> : null;
  const go = (id: string) => { setMenuOpen(false); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  const online = data.requestEnabled;
  const on = (t: RequestType) => online && data.form.types[t];
  /** Anfrage öffnen: Formular unten mit gewählter Art (und ggf. Zimmer und Reisedaten) */
  const ask = (w: Want) => { setWant({ ...w, n: Date.now() }); setTimeout(() => go('gs-anfrage'), 30); };
  const askBtn = (type: RequestType, label: string, cls = '') => <button type="button" className={`gs-btn ${cls}`} onClick={() => ask({ type })}>{label}</button>;
  /** Tisch: online anfragen, sonst Telefon */
  const tableBtn = (label: string, cls = '') => (on('table') ? askBtn('table', label, cls) : callBtn(label, cls));
  return (
    <div className="gs">
      {data.preview && <div className="gs-preview">Vorschau – die Seite ist noch nicht freigeschaltet. Nur Sie als Administrator sehen sie.</div>}
      <header className="gs-header">
        <div className="gs-wrap">
          <a className={`gs-brand logo-${data.logoSize}`} href="#gs-start" onClick={(e) => { e.preventDefault(); go('gs-start'); }} aria-label={data.logo && !data.logoName ? h.name : undefined}>
            {data.logo && <img src={`/api/v1/public/site/logo?v=${data.logo}`} alt={data.logoName ? '' : h.name} />}
            {(data.logoName || !data.logo) && <span className="gs-brand-name">{brand}</span>}{data.brandSubtitle && <span className="gs-brand-sub">{data.brandSubtitle}</span>}
          </a>
          <button type="button" className="gs-menu" aria-expanded={menuOpen} aria-controls="gs-nav" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? 'Menü schließen' : 'Menü öffnen'}</button>
          <nav id="gs-nav" className={`gs-nav ${menuOpen ? 'open' : ''}`} aria-label="Hauptnavigation">
            {nav.filter(([, , on]) => on).map(([id, label]) => <a key={id} href={`#${id}`} onClick={(e) => { e.preventDefault(); go(id); }}>{label}</a>)}
          </nav>
        </div>
      </header>

      <main>
        <section id="gs-start" className={`gs-hero ${img('hero') || data.video ? '' : 'noimg'}`} aria-labelledby="gs-h1">
          {data.video ? <HeroVideo src={`/api/v1/public/site/video?v=${data.video}`} poster={img('hero')} /> : img('hero') && <img src={img('hero')!} alt="" fetchPriority="high" />}
          <div className="gs-hero-in">
            <span className="gs-mono" aria-hidden>{letter}</span>
            {data.heroKicker && <span className="gs-kicker">{data.heroKicker}</span>}
            <Title as="h1" id="gs-h1" s={{ title: data.headline || `Willkommen im ${h.name}`, titleEm: data.headlineEm }} />
            {data.heroText && <p>{data.heroText}</p>}
            <div className="gs-actions">
              {S.reservation.show && tableBtn(online ? 'Tisch anfragen' : 'Tisch telefonisch reservieren', 'light')}
              {hotelOn && <a className="gs-btn outline" href="#gs-hotel" onClick={(e) => { e.preventDefault(); go('gs-hotel'); }}>Zimmer ansehen &amp; anfragen</a>}
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
              <div className="gs-actions">{S.reservation.show && tableBtn(online ? 'Tisch anfragen' : 'Tisch telefonisch reservieren')}{S.menu.show && <a className="gs-link" href="#gs-karte" onClick={(e) => { e.preventDefault(); go('gs-karte'); }}>Zur Speisekarte</a>}</div>
              {S.restaurant.note && <p className="gs-note">{S.restaurant.note}</p>}
            </div>
          </div></Reveal>
        )}

        {hotelOn && <Hotel data={data} img={img('hotel')} letter={letter} ask={ask} />}

        {S.menu.show && (
          <Reveal id="gs-karte" className="gs-section"><div className="gs-wrap">
            <div className="gs-head"><div><span className="gs-kicker">{S.menu.kicker}</span><Title s={S.menu} /></div>{S.menu.note && <p>{S.menu.note}</p>}</div>
            <div className="gs-card"><h3>Vorfreude auf Ihren nächsten Besuch.</h3>{S.menu.text && <p>{S.menu.text}</p>}<div className="gs-actions">{callBtn('Aktuelle Speisekarte erfragen')}{on('question') && <button type="button" className="gs-link" onClick={() => ask({ type: 'question', message: 'Ich interessiere mich für Ihre aktuelle Speisekarte.' })}>Oder schriftlich fragen</button>}</div></div>
          </div></Reveal>
        )}

        {S.events.show && (
          <Reveal id="gs-feiern" className="gs-section gs-soft"><div className="gs-wrap">
            <div className="gs-head"><div><span className="gs-kicker">{S.events.kicker}</span><Title s={S.events} /></div>{S.events.text && <p>{S.events.text}</p>}</div>
            <Pic src={img('events')} alt={`Feiern – ${h.name}`} letter={letter} className="gs-events-pic" />
            {data.eventTypes.length > 0 && <div className="gs-types" style={{ ['--n' as string]: Math.min(4, data.eventTypes.length) }}>{data.eventTypes.map((x) => (MEETING_WORDS.test(x) ? on('meeting') : on('event')) ? <button type="button" key={x} className="gs-type" onClick={() => ask(MEETING_WORDS.test(x) ? { type: 'meeting' } : { type: 'event', occasion: x })}>{x}</button> : <span key={x}>{x}</span>)}</div>}
            {(online || h.email) && <div className="gs-actions">{on('meeting') && askBtn('meeting', 'Tagung oder Versammlung anfragen', 'outline')}{on('event') ? askBtn('event', 'Ihre Veranstaltung anfragen') : <a className="gs-btn" href={mail(h.email, 'Unverbindliche Veranstaltungsanfrage')}>Ihre Veranstaltung anfragen</a>}</div>}
            {S.events.note && <p className="gs-note">{S.events.note}</p>}
          </div></Reveal>
        )}

        {S.vouchers.show && (on('voucher') || h.email) && (
          <Reveal id="gs-gutscheine" className="gs-section"><div className="gs-wrap gs-grid">
            <div className="gs-gift"><span className="gs-kicker">{h.name}</span><h3>Gute Zeit.<br /><em>Verschenkt.</em></h3><small>Gutschein auf Anfrage</small></div>
            <div className="gs-copy">
              <span className="gs-kicker">{S.vouchers.kicker}</span><Title s={S.vouchers} />{S.vouchers.text && <p>{S.vouchers.text}</p>}
              {on('voucher') && <div className="gs-types gs-amounts" style={{ ['--n' as string]: 5 }}>
                {VOUCHER_AMOUNTS.map((a) => <button type="button" key={a} className="gs-type" onClick={() => ask({ type: 'voucher', value: a })}>{a}</button>)}
                <button type="button" className="gs-type" onClick={() => ask({ type: 'voucher', value: '' })}>Individuell</button>
              </div>}
              <div className="gs-actions">{on('voucher') ? askBtn('voucher', 'Gutschein anfragen') : <a className="gs-btn" href={mail(h.email, 'Unverbindliche Gutscheinanfrage')}>Gutschein per E-Mail anfragen</a>}</div>
              {S.vouchers.note && <p className="gs-note">{S.vouchers.note}</p>}
            </div>
          </div></Reveal>
        )}

        {S.reservation.show && (h.phone || h.email) && (
          <Reveal id="gs-reservierung" className="gs-section gs-dark"><div className="gs-wrap gs-grid">
            <div className="gs-copy"><span className="gs-kicker">{S.reservation.kicker}</span><Title s={S.reservation} />{S.reservation.text && <p>{S.reservation.text}</p>}</div>
            <div>
              {h.phone ? <a className="gs-phone" href={tel(h.phone)}>{h.phone}</a> : <a className="gs-phone" href={mail(h.email, 'Tischreservierung')}>{h.email}</a>}
              <div className="gs-actions" style={{ marginTop: 0 }}>{h.phone && callBtn('Jetzt anrufen', 'light')}{on('table') && askBtn('table', 'Online anfragen', h.phone ? 'outline' : 'light')}</div>
              {S.reservation.note && <p className="gs-note">{S.reservation.note}</p>}
            </div>
          </div></Reveal>
        )}

        {online && (
          <section id="gs-anfrage" className="gs-section gs-soft" aria-labelledby="gs-anfrage-titel"><div className="gs-wrap gs-grid" style={{ alignItems: 'start' }}>
            <div className="gs-copy">
              <span className="gs-kicker">Ihre Anfrage</span>
              <h2 id="gs-anfrage-titel">Schreiben Sie uns.<br /><em>Wir melden uns.</em></h2>
              <p>Ob Zimmer, Tisch, Feier, Tagung oder Gutschein: Erzählen Sie uns, was Sie sich wünschen. Wir prüfen Ihre Anfrage persönlich und antworten Ihnen so bald wie möglich.</p>
              <p className="gs-note">Eine Anfrage ist unverbindlich und noch keine Buchung oder Reservierung. Erst unsere Bestätigung macht sie verbindlich.{h.phone && <> Eilig? Rufen Sie uns an: <a className="gs-link" href={tel(h.phone)}>{h.phone}</a></>}</p>
            </div>
            <RequestForm site={data} want={want} />
          </div></section>
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

/**
 * Video im Startbild (z. B. Drohnenflug): ohne Ton, in Schleife. Wer auf dem Gerät „Bewegung reduzieren“ eingestellt hat
 * oder Datensparen nutzt, sieht nur das Startbild. Ein Knopf hält das Video an.
 */
function HeroVideo({ src, poster }: { src: string; poster: string | null }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(true);
  const still = typeof window !== 'undefined' && (window.matchMedia('(prefers-reduced-motion: reduce)').matches
    || (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true);
  if (still) return poster ? <img src={poster} alt="" fetchPriority="high" /> : null;
  const toggle = () => { const v = ref.current; if (!v) return; if (v.paused) { void v.play(); setPlaying(true); } else { v.pause(); setPlaying(false); } };
  return (
    <>
      <video ref={ref} className="gs-hero-video" autoPlay muted loop playsInline preload="auto" poster={poster ?? undefined} aria-hidden onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}>
        <source src={src} />
      </video>
      <button type="button" className="gs-videobtn" onClick={toggle} aria-label={playing ? 'Video anhalten' : 'Video abspielen'}>{playing ? '❚❚' : '▶'}</button>
    </>
  );
}

/** Hotel: Text und Bild, darunter die Zimmer mit Verfügbarkeit und die unverbindliche Anfrage. */
function Hotel({ data, img, letter, ask: askUp }: { data: SitePublic; img: string | null; letter: string; ask: (w: Want) => void }) {
  const S = data.sections.hotel;
  const today = todayBerlin();
  const [q, setQ] = useState({ from: addDays(today, 1), to: addDays(today, 3), adults: '2', children: '0' });
  const [avail, setAvail] = useState<SiteAvailability | null>(null);
  const [searched, setSearched] = useState<typeof q | null>(null);
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const search = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr({});
    try {
      setAvail(await api<SiteAvailability>('GET', `/public/site/availability?${new URLSearchParams({ from: q.from, to: q.to, adults: q.adults, children: q.children })}`));
      setSearched(q);
    } catch (x) { setErr(x instanceof ApiFailure && Object.keys(x.fields).length ? x.fields : { form: x instanceof Error ? x.message : 'Fehler' }); }
    setBusy(false);
  };
  const ask = (c: SiteCategory | null) => { const st = searched ?? q; askUp({ type: 'room', category: c?.name ?? '', from: st.from, to: st.to, adults: st.adults, children: st.children }); };
  const n = searched ? Number(searched.adults) + Number(searched.children) : 0;
  return (
    <Reveal id="gs-hotel" className="gs-section gs-soft"><div className="gs-wrap">
      <div className="gs-grid">
        <div className="gs-copy">
          <span className="gs-kicker">{S.kicker}</span><Title s={S} />{S.text && <p>{S.text}</p>}
          <div className="gs-actions">{data.requestEnabled && data.form.types.room && <button type="button" className="gs-btn" onClick={() => ask(null)}>Zimmer unverbindlich anfragen</button>}</div>
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
                  {data.requestEnabled && data.form.types.room && (!a || a.available) && <button type="button" className="gs-btn" onClick={() => ask(c)}>Anfragen</button>}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div></Reveal>
  );
}

/** Anlässe, die eher eine Tagung sind – führen zum Tagungsformular */
const MEETING_WORDS = /tagung|seminar|fortbildung|schulung|konferenz|workshop|kongress|firmen|innung|versammlung|verein|verband|sitzung|vortrag/i;

interface Want { type: RequestType; category?: string; from?: string; to?: string; adults?: string; children?: string; occasion?: string; message?: string; value?: string; n?: number }
/** feste Gutscheinbeträge zur Auswahl, daneben „Individuell“ */
const VOUCHER_AMOUNTS = ['25 €', '50 €', '75 €', '100 €'];

/** Ein Anfrageformular für alles: Zimmer, Tisch, Feier, Gutschein, Frage. Es wird nichts gebucht. */
function RequestForm({ site, want }: { site: SitePublic; want: Want | null }) {
  const today = todayBerlin();
  const first: RequestType = site.categories.length && site.sections.hotel.show ? 'room' : 'table';
  const empty = { type: first as RequestType, name: '', email: '', phone: '', message: '', consent: false, website: '', from: addDays(today, 1), to: addDays(today, 3), adults: '2', children: '0', category: '',
    date: addDays(today, 1), time: tableTimes(site.form).includes('19:00') ? '19:00' : (tableTimes(site.form)[0] ?? '19:00'), persons: '2', guests: '', occasion: '', value: '',
    organization: '', kind: '', participants: '', rooms: '0', layout: '', equipment: [] as string[], catering: [] as string[] };
  const [v, setV] = useState(empty);
  const [customValue, setCustomValue] = useState(false);
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<RequestType | null>(null);
  useEffect(() => {
    if (!want) return;
    setDone(null); setErr({});
    setV((x) => ({ ...x, type: want.type, category: want.category ?? x.category, from: want.from ?? x.from, to: want.to ?? x.to, adults: want.adults ?? x.adults, children: want.children ?? x.children, occasion: want.occasion ?? x.occasion, message: want.message ?? x.message, value: want.value ?? x.value }));
    if (want.type === 'voucher') setCustomValue(want.value === '' || (!!want.value && !VOUCHER_AMOUNTS.includes(want.value)));
  }, [want]);
  const F = site.form;
  const types = REQUEST_TYPES.filter((t) => F.types[t]).filter((t) => t !== 'room' || (site.categories.length > 0 && site.sections.hotel.show)).filter((t) => t !== 'table' || site.sections.reservation.show || site.sections.restaurant.show)
    .filter((t) => (t !== 'event' && t !== 'meeting') || site.sections.events.show).filter((t) => t !== 'voucher' || site.sections.vouchers.show);
  const send = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr({});
    try { await api('POST', '/public/site/request', v.type === 'meeting' ? { ...v, to: v.to === v.from ? '' : v.to, participants: v.participants === '' ? undefined : v.participants } : { ...v, guests: v.guests === '' ? undefined : v.guests }); setDone(v.type); setV({ ...empty, type: v.type, name: v.name, email: v.email, phone: v.phone }); }
    catch (x) { setErr(x instanceof ApiFailure && Object.keys(x.fields).length ? x.fields : { form: x instanceof Error ? x.message : 'Fehler' }); }
    setBusy(false);
  };
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });
  const f = (k: keyof typeof v, label: string, el: ReactNode, cls = '') => <label className={`gs-f ${cls}`}>{label}{el}{err[k] && <span className="gs-err">{err[k]}</span>}</label>;
  const sel = (k: keyof typeof v, n: number[]) => <select value={String(v[k])} onChange={set(k)}>{n.map((x) => <option key={x}>{x}</option>)}</select>;
  const times = tableTimes(F);
  if (done) return (
    <div className="gs-request" role="status">
      <span className="gs-kicker">Vielen Dank</span>
      <p className="gs-thanks">Ihre Anfrage ist bei uns angekommen.</p>
      <p>Wir melden uns so bald wie möglich bei Ihnen – in der Regel per E-Mail an die angegebene Adresse. Die Anfrage ist noch keine {done === 'room' ? 'Buchung' : done === 'table' ? 'Reservierung' : 'verbindliche Zusage'}.</p>
      <div className="gs-actions"><button type="button" className="gs-link" onClick={() => setDone(null)}>Weitere Anfrage stellen</button></div>
    </div>
  );
  return (
    <form className="gs-request" onSubmit={(e) => void send(e)} noValidate style={{ marginTop: 0 }}>
      <div className="gs-tabs" role="radiogroup" aria-label="Worum geht es?">
        {types.map((t) => <button key={t} type="button" role="radio" aria-checked={v.type === t} className={v.type === t ? 'on' : ''} onClick={() => { setV({ ...v, type: t }); setErr({}); }}>{REQUEST_LABEL[t]}</button>)}
      </div>
      <div className="gs-form">
        {v.type === 'room' && <>
          {f('from', 'Anreise', <input type="date" min={today} value={v.from} onChange={(e) => setV({ ...v, from: e.target.value, to: v.to <= e.target.value ? addDays(e.target.value, 1) : v.to })} />)}
          {f('to', 'Abreise', <input type="date" min={addDays(v.from || today, 1)} value={v.to} onChange={set('to')} />)}
          {f('adults', 'Erwachsene', sel('adults', [1, 2, 3, 4, 5, 6, 7, 8]))}{f('children', 'Kinder', sel('children', [0, 1, 2, 3, 4, 5]))}
          {f('category', 'Zimmerwunsch', <select value={v.category} onChange={set('category')}><option value="">egal / bitte beraten</option>{site.categories.map((c) => <option key={c.id}>{c.name}</option>)}</select>, 'full')}
        </>}
        {v.type === 'table' && <>
          {f('date', 'Tag', <input type="date" min={today} value={v.date} onChange={set('date')} />, 'wide')}
          {f('time', 'Uhrzeit', <select value={v.time} onChange={set('time')}>{times.map((x) => <option key={x}>{x}</option>)}</select>)}
          {f('persons', 'Personen', sel('persons', Array.from({ length: F.tableMaxPersons }, (_, i) => i + 1)))}
        </>}
        {v.type === 'event' && <>
          {f('occasion', 'Anlass', <input list="gs-anlaesse" value={v.occasion} onChange={set('occasion')} placeholder="z. B. Geburtstag" />, 'wide')}
          {f('date', 'Wunschtermin (falls bekannt)', <input type="date" min={today} value={v.date} onChange={set('date')} />)}
          {f('guests', 'Gäste (ungefähr)', <input inputMode="numeric" value={v.guests} onChange={set('guests')} />)}
          <datalist id="gs-anlaesse">{site.eventTypes.map((x) => <option key={x} value={x} />)}</datalist>
        </>}
        {v.type === 'meeting' && <>
          {f('organization', 'Veranstalter', <input autoComplete="organization" value={v.organization} onChange={set('organization')} placeholder="z. B. Bäckerinnung, Sportverein, Arztpraxis, Firma" />, 'full')}
          {F.meetingKinds.length > 0 && f('kind', 'Art der Veranstaltung', <select value={v.kind} onChange={set('kind')}><option value="">bitte wählen (freiwillig)</option>{F.meetingKinds.map((x) => <option key={x}>{x}</option>)}</select>, 'full')}
          {f('from', 'Erster Tag', <input type="date" min={today} value={v.from} onChange={(e) => setV({ ...v, from: e.target.value, to: v.to < e.target.value ? e.target.value : v.to })} />, 'wide')}
          {f('to', 'Letzter Tag', <input type="date" min={v.from || today} value={v.to} onChange={set('to')} />, 'wide')}
          {f('participants', 'Teilnehmer, ungefähr', <input inputMode="numeric" value={v.participants} onChange={set('participants')} />, 'wide')}
          {f('rooms', 'Zimmer je Nacht (0 = keine)', <input inputMode="numeric" value={v.rooms} onChange={set('rooms')} />, 'wide')}
          {F.layouts.length > 0 && f('layout', 'Bestuhlung', <select value={v.layout} onChange={set('layout')}><option value="">egal / bitte beraten</option>{F.layouts.map((x) => <option key={x}>{x}</option>)}</select>, 'full')}
          {F.equipment.length > 0 && <fieldset className="gs-chips full"><legend>Technik</legend>{F.equipment.map((x) => <label key={x}><input type="checkbox" checked={v.equipment.includes(x)} onChange={(e) => setV({ ...v, equipment: e.target.checked ? [...v.equipment, x] : v.equipment.filter((y) => y !== x) })} /><span>{x}</span></label>)}</fieldset>}
          {F.catering.length > 0 && <fieldset className="gs-chips full"><legend>Verpflegung</legend>{F.catering.map((x) => <label key={x}><input type="checkbox" checked={v.catering.includes(x)} onChange={(e) => setV({ ...v, catering: e.target.checked ? [...v.catering, x] : v.catering.filter((y) => y !== x) })} /><span>{x}</span></label>)}</fieldset>}
        </>}
        {v.type === 'voucher' && <fieldset className="gs-chips full" role="radiogroup"><legend>Betrag</legend>
          {VOUCHER_AMOUNTS.map((a) => <label key={a}><input type="radio" name="gs-amount" checked={!customValue && v.value === a} onChange={() => { setCustomValue(false); setV({ ...v, value: a }); }} /><span>{a}</span></label>)}
          <label><input type="radio" name="gs-amount" checked={customValue} onChange={() => { setCustomValue(true); setV({ ...v, value: VOUCHER_AMOUNTS.includes(v.value) ? '' : v.value }); }} /><span>Individuell</span></label>
        </fieldset>}
        {v.type === 'voucher' && customValue && f('value', 'Ihr Wunschbetrag oder Wunsch', <input value={v.value} onChange={set('value')} placeholder="z. B. 40 € oder „Abendessen für zwei“" autoFocus />, 'full')}
        {f('name', 'Ihr Name', <input autoComplete="name" value={v.name} onChange={set('name')} />, 'wide')}
        {f('email', 'E-Mail', <input type="email" autoComplete="email" value={v.email} onChange={set('email')} />, 'wide')}
        {f('phone', 'Telefon (freiwillig)', <input type="tel" autoComplete="tel" value={v.phone} onChange={set('phone')} />, 'wide')}
        {f('message', v.type === 'question' ? 'Ihre Frage' : v.type === 'event' ? 'Ihre Wünsche' : v.type === 'meeting' ? 'Ablauf, Zeiten, Wünsche (freiwillig)' : 'Nachricht (freiwillig)', <textarea rows={v.type === 'question' || v.type === 'event' ? 5 : 3} value={v.message} onChange={set('message')} />, 'full')}
        <input className="hp" tabIndex={-1} autoComplete="off" aria-hidden value={v.website} onChange={set('website')} />
        <label className="gs-check full"><input type="checkbox" checked={v.consent} onChange={(e) => setV({ ...v, consent: e.target.checked })} />
          <span>Ich habe den Hinweis zum Datenschutz gelesen.{site.privacyText && <><br /><small>{site.privacyText}</small></>}{site.privacyUrl && <> <a className="gs-link" href={site.privacyUrl} rel="noopener">Datenschutzerklärung</a></>}{err.consent && <><br /><span className="gs-err">{err.consent}</span></>}</span></label>
      </div>
      {err.form && <p className="gs-err">{err.form}</p>}
      <div className="gs-actions"><button type="submit" className="gs-btn" disabled={busy}>{busy ? 'Wird gesendet …' : 'Anfrage senden'}</button></div>
    </form>
  );
}
