import { useEffect, useState, type ReactNode } from 'react';
import type { CategoryDto } from '../../../src/shared/hotel.js';
import { IMAGE_LABEL, SECTION_DEFAULTS, SECTION_KEYS, SECTION_LABEL, siteSettingsInput, type SectionKey, type SiteSettings } from '../../../src/shared/site.js';
import { api } from '../api.ts';
import { Button, Field, LoadState, useLoad, useSubmit, useToast } from '../ui.tsx';

/** Foto verkleinern (höchstens 1920 × 1280 Pixel, JPEG), damit Handyfotos schnell laden. */
async function shrink(file: File, maxW = 1920, maxH = 1280): Promise<string> {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, maxW / img.width, maxH / img.height);
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.82).split(',')[1]!;
}

/** Bildfeld mit Vorschau: Hochladen speichert sofort. */
function ImageField({ label, src, upload, remove, at }: { label: string; src: string; upload: (f: File) => Promise<void>; remove: () => Promise<void>; at: number | undefined }) {
  return (
    <div className="site-admin-cat">
      <div className="site-admin-photo">{at === undefined || at > 0 ? <img src={`${src}?t=${at ?? 0}`} alt="" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} /> : null}<span>kein Bild</span></div>
      <div><b>{label}</b>
        <div className="btnrow" style={{ marginTop: 8 }}><label className="btn">Bild wählen<input type="file" accept="image/jpeg,image/png" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} /></label><Button onClick={() => void remove()}>Entfernen</Button></div>
      </div>
    </div>
  );
}

const Group = ({ title, children, open = false }: { title: string; children: ReactNode; open?: boolean }) => (
  <details className="site-group" open={open}><summary>{title}</summary><div className="site-group-body">{children}</div></details>
);

/** Einstellungen → Online → Gästeseite: was Gäste öffentlich sehen. */
export function GuestSiteCard() {
  const toast = useToast();
  const { data, error } = useLoad(() => api<SiteSettings>('GET', '/settings/site'));
  const [rev, setRev] = useState(0);
  const cats = useLoad(() => api<CategoryDto[]>('GET', '/categories'), [rev]).data;
  const req = useLoad(() => api<{ enabled: boolean }>('GET', '/settings/web-request').catch(() => ({ enabled: false }))).data;
  const [v, setV] = useState<SiteSettings | null>(null);
  const [at, setAt] = useState<Record<string, number>>({});
  useEffect(() => { if (data) setV(data); }, [data]);
  const f = useSubmit(siteSettingsInput, async (d) => { setV(await api<SiteSettings>('PUT', '/settings/site', d)); toast('Gästeseite gespeichert'); });
  if (!v || !cats) return <section className="card"><h2>Gästeseite</h2><LoadState error={error} loading /></section>;
  const cat = (id: string) => v.categories[id] ?? { show: false, text: '' };
  const setCat = (id: string, p: Partial<{ show: boolean; text: string }>) => setV({ ...v, categories: { ...v.categories, [id]: { ...cat(id), ...p } } });
  const setSec = (k: SectionKey, p: Partial<SiteSettings['sections'][SectionKey]>) => setV({ ...v, sections: { ...v.sections, [k]: { ...v.sections[k], ...p } } });
  const put = async (path: string, key: string, file: File, hero = false) => {
    try { await api('PUT', path, { mime: 'image/jpeg', dataBase64: await shrink(file, hero ? 2400 : 1920, hero ? 1600 : 1280) }); setAt({ ...at, [key]: Date.now() }); toast('Bild gespeichert'); }
    catch (e) { toast(e instanceof Error ? e.message : 'Bild konnte nicht gespeichert werden', 'error'); }
  };
  const del = async (path: string, key: string) => { await api('DELETE', path); setAt({ ...at, [key]: -Date.now() }); setRev(rev + 1); toast('Bild entfernt'); };
  const txt = (k: 'brandSubtitle' | 'heroKicker' | 'headline' | 'headlineEm' | 'introKicker' | 'introTitle' | 'introTitleEm', label: string, hint?: string) => (
    <Field label={label} error={f.errors[k]} hint={hint}><input value={v[k]} maxLength={120} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></Field>
  );
  const area = (k: 'heroText' | 'intro' | 'highlights' | 'eventTypes' | 'hours' | 'hoursNote' | 'faq', label: string, rows: number, hint?: string, placeholder?: string) => (
    <Field label={label} error={f.errors[k]} hint={hint} wide><textarea rows={rows} value={v[k]} placeholder={placeholder} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></Field>
  );
  return (
    <form className="card" onSubmit={(e) => void f.submit(v, e)} noValidate>
      <div className="cardhead"><div><h2>Gästeseite</h2><p className="muted">Eine öffentliche Seite für Ihre Gäste: Haus, Restaurant, Zimmer mit Verfügbarkeit und Anfrage, Feiern, Gutscheine, Kontakt. Gebucht und bezahlt wird darüber nichts – Zimmeranfragen kommen in den E-Mail-Posteingang, alles andere öffnet das Telefon oder E-Mail-Programm des Gastes.</p></div>
        <a className="btn" href="/willkommen" target="_blank" rel="noopener">Seite ansehen</a></div>
      <div className="formgrid">
        <label className="check wide"><input type="checkbox" checked={v.enabled} onChange={(e) => setV({ ...v, enabled: e.target.checked })} /><span><b>Gästeseite freischalten</b> <small>Adresse: <code>{window.location.origin}/willkommen</code> – vorher sehen nur Sie als Administrator die Vorschau.</small></span></label>
        <label className="check wide"><input type="checkbox" checked={v.homepage} onChange={(e) => setV({ ...v, homepage: e.target.checked })} /><span>Als Startseite verwenden <small>Wer die Hauptadresse aufruft und nicht angemeldet ist, sieht die Gästeseite. Mitarbeiter melden sich über <code>{window.location.origin}/anmelden</code> an.</small></span></label>
      </div>

      <Group title="Kopf und Startbild" open>
        <div className="formgrid">
          {txt('brandSubtitle', 'Zeile unter dem Namen', 'z. B. HOTEL & RESTAURANT · WILKAU-HASSLAU')}{txt('heroKicker', 'Kleine Zeile über der Überschrift')}
          {txt('headline', 'Überschrift, erste Zeile')}{txt('headlineEm', 'Überschrift, zweite Zeile (kursiv)')}
          {area('heroText', 'Text unter der Überschrift', 2)}
        </div>
        <ImageField label={IMAGE_LABEL.hero} src="/api/v1/public/site/image/hero" at={at.hero} upload={(file) => put('/settings/site/image/hero', 'hero', file, true)} remove={() => del('/settings/site/image/hero', 'hero')} />
      </Group>

      <Group title="Begrüßung">
        <div className="formgrid">
          {txt('introKicker', 'Kleine Zeile', 'leer = Name des Hauses')}{txt('introTitle', 'Überschrift')}{txt('introTitleEm', 'Zweite Zeile (kursiv)')}
          {area('intro', 'Text', 4)}{area('highlights', 'Das bieten wir', 3, 'je Zeile ein Punkt, z. B. Kostenloses WLAN')}
        </div>
      </Group>

      {SECTION_KEYS.map((k) => (
        <Group key={k} title={`${SECTION_LABEL[k]}${v.sections[k].show ? '' : ' (ausgeblendet)'}`}>
          <label className="check"><input type="checkbox" checked={v.sections[k].show} onChange={(e) => setSec(k, { show: e.target.checked })} /><span>Bereich anzeigen</span></label>
          <div className="formgrid">
            <Field label="Kleine Zeile"><input value={v.sections[k].kicker} maxLength={80} onChange={(e) => setSec(k, { kicker: e.target.value })} /></Field>
            <Field label="Überschrift"><input value={v.sections[k].title} maxLength={120} onChange={(e) => setSec(k, { title: e.target.value })} /></Field>
            <Field label="Zweite Zeile (kursiv)"><input value={v.sections[k].titleEm} maxLength={120} onChange={(e) => setSec(k, { titleEm: e.target.value })} /></Field>
            <Field label="Text" wide><textarea rows={3} value={v.sections[k].text} onChange={(e) => setSec(k, { text: e.target.value })} /></Field>
            <Field label="Hinweis (klein)" wide><textarea rows={2} value={v.sections[k].note} onChange={(e) => setSec(k, { note: e.target.value })} /></Field>
          </div>
          <div className="btnrow"><Button onClick={() => setSec(k, { ...SECTION_DEFAULTS[k], note: SECTION_DEFAULTS[k].note ?? '' })}>Vorschlagstext einsetzen</Button></div>
          {k === 'restaurant' && <ImageField label={IMAGE_LABEL.restaurant} src="/api/v1/public/site/image/restaurant" at={at.restaurant} upload={(file) => put('/settings/site/image/restaurant', 'restaurant', file)} remove={() => del('/settings/site/image/restaurant', 'restaurant')} />}
          {k === 'events' && <><div className="formgrid">{area('eventTypes', 'Anlässe', 3, 'je Zeile einer, höchstens 8')}</div><ImageField label={IMAGE_LABEL.events} src="/api/v1/public/site/image/events" at={at.events} upload={(file) => put('/settings/site/image/events', 'events', file)} remove={() => del('/settings/site/image/events', 'events')} /></>}
          {k === 'contact' && <div className="formgrid">
            {area('hours', 'Öffnungszeiten', 4, 'je Zeile „Tage | Zeit“', 'Mittwoch – Samstag | 17:00 – 22:00 Uhr\nSonntag – Dienstag | Ruhetag')}{area('hoursNote', 'Hinweis zu den Zeiten', 2)}
            <label className="check wide"><input type="checkbox" checked={v.routeLink} onChange={(e) => setV({ ...v, routeLink: e.target.checked })} /><span>Knopf „Route planen – Google Maps“ <small>öffnet Google Maps erst, wenn der Gast darauf klickt</small></span></label>
          </div>}
          {k === 'faq' && <div className="formgrid">{area('faq', 'Fragen und Antworten', 8, 'Frage in die erste Zeile, Antwort darunter, zwischen zwei Fragen eine Leerzeile', 'Wie reserviere ich einen Tisch?\nBitte rufen Sie uns an …\n\nIst das Hotel stufenlos erreichbar?\n…')}</div>}
          {k === 'hotel' && <>
            <div className="formgrid">
              <label className="check wide"><input type="checkbox" checked={v.showAvailability} onChange={(e) => setV({ ...v, showAvailability: e.target.checked })} /><span>Verfügbarkeit prüfen anbieten <small>Gäste geben Reisedaten ein und sehen je Kategorie, ob etwas frei ist (nicht, wie viele Zimmer)</small></span></label>
              <label className="check wide"><input type="checkbox" checked={v.showPrices} onChange={(e) => setV({ ...v, showPrices: e.target.checked })} /><span>Preise anzeigen <small>„ab … / Nacht“ und nach der Suche der Preis für den Aufenthalt – nach Ihren Preisregeln</small></span></label>
            </div>
            <ImageField label={IMAGE_LABEL.hotel} src="/api/v1/public/site/image/hotel" at={at.hotel} upload={(file) => put('/settings/site/image/hotel', 'hotel', file)} remove={() => del('/settings/site/image/hotel', 'hotel')} />
            <h3>Zimmerkategorien</h3>
            {cats.length === 0 && <p className="muted">Noch keine Kategorien angelegt (Hotel → Zimmer &amp; Preise).</p>}
            <div className="site-admin-cats">
              {cats.map((c) => (
                <div key={c.id} className="site-admin-cat">
                  <div className="site-admin-photo">{at[c.id] === undefined || at[c.id]! > 0 ? <img src={`/api/v1/categories/${c.id}/photo?t=${at[c.id] ?? 0}`} alt="" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} /> : null}<span>kein Foto</span></div>
                  <div>
                    <label className="check"><input type="checkbox" checked={cat(c.id).show} onChange={(e) => setCat(c.id, { show: e.target.checked })} /><span><b>{c.name}</b> auf der Gästeseite zeigen</span></label>
                    <Field label="Beschreibung für Gäste" hint="leer = interne Beschreibung"><textarea rows={2} maxLength={800} value={cat(c.id).text} onChange={(e) => setCat(c.id, { text: e.target.value })} /></Field>
                    <div className="btnrow"><label className="btn">Foto wählen<input type="file" accept="image/jpeg,image/png" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) void put(`/categories/${c.id}/photo`, c.id, file); e.target.value = ''; }} /></label><Button onClick={() => void del(`/categories/${c.id}/photo`, c.id)}>Foto entfernen</Button></div>
                  </div>
                </div>
              ))}
            </div>
          </>}
          {(k === 'vouchers' || k === 'events') && <p className="muted small">Die Anfrage öffnet das E-Mail-Programm des Gastes mit Ihrer Adresse aus „Haus“. Ohne E-Mail-Adresse wird {k === 'vouchers' ? 'der Bereich' : 'der Knopf'} nicht angezeigt.</p>}
          {(k === 'reservation' || k === 'menu') && <p className="muted small">Der Knopf ruft Ihre Telefonnummer aus „Haus“ an (ohne Nummer: E-Mail).</p>}
        </Group>
      ))}

      <Group title="Rechtliches">
        <div className="formgrid">
          <Field label="Impressum (Adresse der Seite)" error={f.errors.imprintUrl} hint="z. B. https://www.ihr-haus.de/impressum"><input value={v.imprintUrl} onChange={(e) => setV({ ...v, imprintUrl: e.target.value })} /></Field>
          <Field label="Datenschutzerklärung (Adresse der Seite)" error={f.errors.privacyUrl}><input value={v.privacyUrl} onChange={(e) => setV({ ...v, privacyUrl: e.target.value })} /></Field>
        </div>
      </Group>

      {(!v.imprintUrl || !v.privacyUrl) && <p className="notice warn">Eine öffentlich erreichbare Seite braucht in Deutschland in der Regel ein Impressum und eine Datenschutzerklärung. Tragen Sie unter „Rechtliches“ die Adressen Ihrer bestehenden Seiten ein. Ob die Inhalte genügen, kann das Programm nicht prüfen – bitte rechtlich prüfen lassen.</p>}
      {req && !req.enabled && <p className="notice warn">Die Online-Anfrage ist ausgeschaltet – auf der Gästeseite erscheint dann kein „Anfragen“ für Zimmer. Einschalten unter E-Mail → Online-Anfrage.</p>}
      <div className="formactions"><Button type="submit" variant="primary" busy={f.busy}>Speichern</Button></div>
      <p className="muted small">Bilder werden beim Hochladen verkleinert und sofort gespeichert; Texte und Haken erst mit „Speichern“. Adresse, Telefon und E-Mail kommen aus Einstellungen → Haus. Angezeigt werden nur Zimmerkategorien mit mindestens einem aktiven Zimmer. Bitte nur Bilder verwenden, an denen Sie die Rechte haben; die Seite lädt keine Bilder oder Schriften von fremden Servern.</p>
    </form>
  );
}
