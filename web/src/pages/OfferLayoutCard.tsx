import { useEffect, useState } from 'react';
import { offerLayoutInput, type OfferLayout } from '../../../src/shared/offers.js';
import { api } from '../api.ts';
import { Button, Field, LoadState, useLoad, useSubmit, useToast } from '../ui.tsx';

const ACCENTS: [OfferLayout['accent'], string, string][] = [['black', 'Schwarz', '#1a1a1a'], ['blue', 'Dunkelblau', '#1c457a'], ['green', 'Tannengrün', '#215c40'], ['red', 'Weinrot', '#801f29'], ['gold', 'Gold', '#8c6b29'], ['petrol', 'Petrol', '#126169']];

/** Gestaltung des Angebots-PDFs – mit Vorschau als Muster-Angebot (erfundene Angaben). */
export function OfferLayoutCard() {
  const toast = useToast();
  const { data, error } = useLoad(() => api<OfferLayout>('GET', '/settings/offer-layout'));
  const [v, setV] = useState<OfferLayout | null>(null);
  useEffect(() => { if (data) setV(data); }, [data]);
  const f = useSubmit(offerLayoutInput, async (d) => { await api('PUT', '/settings/offer-layout', d); toast('Angebotslayout gespeichert'); });
  if (!v) return <section className="card"><h2>Gestaltung der Angebote</h2><LoadState error={error} loading /></section>;
  const set = (p: Partial<OfferLayout>) => setV({ ...v, ...p });
  const preview = () => window.open(`/api/v1/settings/offer-layout/preview?${new URLSearchParams(Object.entries(v).map(([k, x]) => [k, String(x)])).toString()}`, '_blank', 'noopener');
  const sel = <K extends keyof OfferLayout>(k: K, label: string, opts: [string, string][], hint?: string) => (
    <Field label={label} hint={hint}><select value={String(v[k])} disabled={v.likeInvoice && SHARED.includes(k)} onChange={(e) => set({ [k]: e.target.value } as Partial<OfferLayout>)}>{opts.map(([x, t]) => <option key={x} value={x}>{t}</option>)}</select></Field>
  );
  const check = (k: 'signature' | 'questionBoxes' | 'senderLine' | 'foldMarks' | 'letterhead', label: string, hint: string) => (
    <label className="check"><input type="checkbox" checked={v[k]} disabled={v.likeInvoice && SHARED.includes(k)} onChange={(e) => set({ [k]: e.target.checked })} /><span>{label}<small>{hint}</small></span></label>
  );
  return (
    <form className="card" onSubmit={(e) => void f.submit(v, e)} noValidate>
      <h2>Gestaltung der Angebote</h2>
      <p className="muted">Gilt für Angebote, die ab jetzt als PDF erzeugt oder versendet werden. Bereits versendete Angebote bleiben unverändert. Die Vorschau zeigt ein Muster-Angebot mit erfundenen Angaben, auch ohne zu speichern. Logo und Anschrift kommen aus den Angaben zum Haus.</p>
      <label className="check big"><input type="checkbox" checked={v.likeInvoice} onChange={(e) => set({ likeInvoice: e.target.checked })} />
        <span>Wie die Rechnung gestalten<small>Stil, Farbe, Schrift, Logo, Tabelle, Abstände und Papier aus dem Rechnungslayout übernehmen (Einstellungen → Betrieb → Haus). Ausschalten, um Angebote eigens zu gestalten.</small></span></label>
      <div className={`formgrid cols3${v.likeInvoice ? ' dimmed' : ''}`}>
        {sel('style', 'Stil', [['classic', 'klassisch – grau hinterlegt'], ['modern', 'modern – Farbbalken und farbige Kopfzeile'], ['elegant', 'elegant – feine Linien']])}
        <Field label="Farbe" hint="für Linien, Überschrift und Hervorhebungen">
          <div className="swatches" role="radiogroup" aria-label="Farbe">{ACCENTS.map(([k, name, hex]) => (
            <button key={k} type="button" role="radio" aria-checked={v.accent === k} title={name} disabled={v.likeInvoice} className={v.accent === k ? 'on' : ''} style={{ background: hex }} onClick={() => set({ accent: k })}><span className="sr-only">{name}</span></button>
          ))}
            <label className={`swatch-custom${v.accent === 'custom' ? ' on' : ''}`} title="Eigene Farbe wählen" style={{ background: v.accentHex }}>
              <input type="color" value={v.accentHex} disabled={v.likeInvoice} onChange={(e) => set({ accent: 'custom', accentHex: e.target.value })} aria-label="Eigene Farbe" />
              <span aria-hidden>+</span>
            </label>
          </div>
        </Field>
        {sel('font', 'Schrift', [['sans', 'schlicht (ohne Serifen)'], ['serif', 'klassisch (mit Serifen)']])}
        {sel('logoPos', 'Logo', [['right', 'rechts'], ['left', 'links'], ['center', 'mittig, Anschrift darunter']], 'Position im Kopf')}
        {sel('logoSize', 'Logo-Größe', [['small', 'klein'], ['normal', 'mittel'], ['large', 'groß']])}
        {sel('table', 'Positionen', [['lines', 'mit Trennlinien'], ['stripes', 'abwechselnd hinterlegt'], ['plain', 'ohne Linien']])}
        {sel('spacing', 'Abstände', [['compact', 'eng'], ['normal', 'normal'], ['wide', 'großzügig']])}
        {sel('fontSize', 'Schriftgröße', [['small', 'klein'], ['normal', 'normal'], ['large', 'groß']])}
      </div>
      <h3>Inhalt</h3>
      <div className="formgrid cols3">
        {sel('prices', 'Preise', [['all', 'Einzelpreis und Betrag je Position'], ['total', 'nur Gesamtbetrag (Pauschalangebot)']], 'Mengen werden immer gezeigt')}
      </div>
      <div className="checkgrid">
        {check('signature', 'Feld für die Unterschrift', '„Angebot angenommen: Ort, Datum, Unterschrift“ – für die Annahme auf Papier')}
        {check('questionBoxes', 'Fragen zum Ausfüllen', 'Fragenkatalog mit Kästchen zum handschriftlichen Ausfüllen statt als Aufzählung')}
      </div>
      <h3>Druck und Papier</h3>
      <div className={`checkgrid${v.likeInvoice ? ' dimmed' : ''}`}>
        {check('senderLine', 'Absenderzeile über der Anschrift', 'kleine Zeile mit Ihrer Anschrift – sichtbar im Fensterumschlag')}
        {check('foldMarks', 'Falz- und Lochmarken', 'kurze Striche am linken Rand zum sauberen Falten und Lochen')}
        {check('letterhead', 'Vorgedrucktes Briefpapier', 'Kopf (Name, Logo) und Fuß werden nicht gedruckt – der Platz bleibt frei')}
      </div>
      <div className="formactions"><Button onClick={preview}>Vorschau (PDF)</Button><Button type="submit" variant="primary" busy={f.busy}>Speichern</Button></div>
    </form>
  );
}
/** Angaben, die bei „wie die Rechnung“ aus dem Rechnungslayout kommen */
const SHARED: (keyof OfferLayout)[] = ['style', 'accent', 'accentHex', 'font', 'logoPos', 'logoSize', 'table', 'spacing', 'fontSize', 'senderLine', 'foldMarks', 'letterhead'];
