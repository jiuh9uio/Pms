import { useEffect, useState } from 'react';
import type { CategoryDto } from '../../../src/shared/hotel.js';
import { siteSettingsInput, type SiteSettings } from '../../../src/shared/site.js';
import { api } from '../api.ts';
import { Button, Field, LoadState, useLoad, useSubmit, useToast } from '../ui.tsx';

/** Foto verkleinern (höchstens 1600 Pixel breit, JPEG), damit Handyfotos schnell laden. */
async function shrink(file: File): Promise<string> {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / img.width, 1200 / img.height);
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.82).split(',')[1]!;
}

/** Einstellungen → Online → Gästeseite: was Gäste öffentlich sehen. */
export function GuestSiteCard() {
  const toast = useToast();
  const { data, error } = useLoad(() => api<SiteSettings>('GET', '/settings/site'));
  const [rev, setRev] = useState(0);
  const cats = useLoad(() => api<CategoryDto[]>('GET', '/categories'), [rev]).data;
  const req = useLoad(() => api<{ enabled: boolean }>('GET', '/settings/web-request').catch(() => ({ enabled: false }))).data;
  const [v, setV] = useState<SiteSettings | null>(null);
  const [photoAt, setPhotoAt] = useState<Record<string, number>>({});
  useEffect(() => { if (data) setV(data); }, [data]);
  const f = useSubmit(siteSettingsInput, async (d) => { setV(await api<SiteSettings>('PUT', '/settings/site', d)); toast('Gästeseite gespeichert'); });
  if (!v || !cats) return <section className="card"><h2>Gästeseite</h2><LoadState error={error} loading /></section>;
  const cat = (id: string) => v.categories[id] ?? { show: false, text: '' };
  const setCat = (id: string, p: Partial<{ show: boolean; text: string }>) => setV({ ...v, categories: { ...v.categories, [id]: { ...cat(id), ...p } } });
  const upload = async (id: string, file: File | undefined) => {
    if (!file) return;
    try { await api('PUT', `/categories/${id}/photo`, { mime: 'image/jpeg', dataBase64: await shrink(file) }); setPhotoAt({ ...photoAt, [id]: Date.now() }); toast('Foto gespeichert'); }
    catch (e) { toast(e instanceof Error ? e.message : 'Foto konnte nicht gespeichert werden', 'error'); }
  };
  const removePhoto = async (id: string) => { await api('DELETE', `/categories/${id}/photo`); setPhotoAt({ ...photoAt, [id]: -Date.now() }); setRev(rev + 1); toast('Foto entfernt'); };
  const url = `${window.location.origin}/willkommen`;
  return (
    <form className="card" onSubmit={(e) => void f.submit(v, e)} noValidate>
      <div className="cardhead"><div><h2>Gästeseite</h2><p className="muted">Eine öffentliche Seite für Ihre Gäste: Zimmer mit Foto und Beschreibung, Verfügbarkeit und Preis für einen Zeitraum, unverbindliche Anfrage. Gebucht und bezahlt wird darüber nichts – die Anfrage kommt in den E-Mail-Posteingang.</p></div>
        <a className="btn" href="/willkommen" target="_blank" rel="noopener">Seite ansehen</a></div>
      <div className="formgrid">
        <label className="check wide"><input type="checkbox" checked={v.enabled} onChange={(e) => setV({ ...v, enabled: e.target.checked })} /><span><b>Gästeseite freischalten</b> <small>Adresse: <code>{url}</code> – vorher sehen nur Sie als Administrator die Vorschau.</small></span></label>
        <label className="check wide"><input type="checkbox" checked={v.homepage} onChange={(e) => setV({ ...v, homepage: e.target.checked })} /><span>Als Startseite verwenden <small>Wer die Hauptadresse aufruft und nicht angemeldet ist, sieht die Gästeseite. Mitarbeiter melden sich dann über <code>{window.location.origin}/anmelden</code> an (Link „Mitarbeiter“ unten auf der Seite).</small></span></label>
        <Field label="Überschrift" error={f.errors.headline} wide hint={`leer = „Willkommen im …“`}><input value={v.headline} maxLength={120} onChange={(e) => setV({ ...v, headline: e.target.value })} /></Field>
        <Field label="Einleitung" error={f.errors.intro} wide><textarea rows={3} maxLength={1200} value={v.intro} onChange={(e) => setV({ ...v, intro: e.target.value })} placeholder="Ein paar Sätze zu Ihrem Haus, zur Lage, zum Restaurant …" /></Field>
        <Field label="Das bieten wir" error={f.errors.highlights} wide hint="je Zeile ein Punkt, z. B. Kostenloses WLAN · Parkplatz am Haus · Frühstücksbuffet"><textarea rows={4} maxLength={1200} value={v.highlights} onChange={(e) => setV({ ...v, highlights: e.target.value })} /></Field>
        <label className="check wide"><input type="checkbox" checked={v.showPrices} onChange={(e) => setV({ ...v, showPrices: e.target.checked })} /><span>Preise anzeigen <small>„ab … / Nacht“ und nach der Suche der Preis für den Aufenthalt – nach Ihren Preisregeln, inklusive Nachlässen</small></span></label>
        <Field label="Impressum (Adresse der Seite)" error={f.errors.imprintUrl} hint="z. B. https://www.ihr-haus.de/impressum"><input value={v.imprintUrl} onChange={(e) => setV({ ...v, imprintUrl: e.target.value })} /></Field>
        <Field label="Datenschutzerklärung (Adresse der Seite)" error={f.errors.privacyUrl}><input value={v.privacyUrl} onChange={(e) => setV({ ...v, privacyUrl: e.target.value })} /></Field>
      </div>
      {(!v.imprintUrl || !v.privacyUrl) && <p className="notice warn">Eine öffentlich erreichbare Seite braucht in Deutschland in der Regel ein Impressum und eine Datenschutzerklärung. Tragen Sie die Adressen Ihrer bestehenden Seiten ein. Ob die Inhalte genügen, kann das Programm nicht prüfen – bitte rechtlich prüfen lassen.</p>}
      {req && !req.enabled && <p className="notice warn">Die Online-Anfrage ist ausgeschaltet – auf der Gästeseite erscheint dann kein „Anfragen“. Einschalten unter E-Mail → Online-Anfrage.</p>}

      <h3>Zimmerkategorien auf der Seite</h3>
      {cats.length === 0 && <p className="muted">Noch keine Kategorien angelegt (Hotel → Zimmer &amp; Preise).</p>}
      <div className="site-admin-cats">
        {cats.map((c) => {
          const at = photoAt[c.id];
          return (
            <div key={c.id} className="site-admin-cat">
              <div className="site-admin-photo">{at === undefined || at > 0 ? <img src={`/api/v1/categories/${c.id}/photo?t=${at ?? 0}`} alt="" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} /> : null}<span>kein Foto</span></div>
              <div>
                <label className="check"><input type="checkbox" checked={cat(c.id).show} onChange={(e) => setCat(c.id, { show: e.target.checked })} /><span><b>{c.name}</b> auf der Gästeseite zeigen</span></label>
                <Field label="Beschreibung für Gäste" hint={`leer = interne Beschreibung${c.description ? ` („${c.description.slice(0, 40)}…“)` : ''}`}><textarea rows={2} maxLength={800} value={cat(c.id).text} onChange={(e) => setCat(c.id, { text: e.target.value })} /></Field>
                <div className="btnrow"><label className="btn">Foto wählen<input type="file" accept="image/jpeg,image/png" hidden onChange={(e) => void upload(c.id, e.target.files?.[0])} /></label><Button onClick={() => void removePhoto(c.id)}>Foto entfernen</Button></div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="formactions"><Button type="submit" variant="primary" busy={f.busy}>Speichern</Button></div>
      <p className="muted small">Fotos werden beim Hochladen verkleinert und sofort gespeichert; Texte und Haken erst mit „Speichern“. Angezeigt werden nur Kategorien mit mindestens einem aktiven Zimmer. Gäste sehen, <b>ob</b> etwas frei ist, aber nicht, wie viele Zimmer. Bitte nur Fotos verwenden, an denen Sie die Rechte haben.</p>
    </form>
  );
}
