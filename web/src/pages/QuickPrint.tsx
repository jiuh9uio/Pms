import { useState } from 'react';
import { printTemplateInput, quickTextInput, reviewSlipInput, type QuickPrintDto, type QuickSlipDto, type SlipSuggestionDto } from '../../../src/shared/schemas.js';
import { api } from '../api.ts';
import { useAuth } from '../App.tsx';
import { Button, Dialog, Field, LoadState, PageHeader, useLoad, useSubmit, useToast } from '../ui.tsx';

/** Bereich „Schnelldruck“: Info-Zettel für Gäste mit einem Tipp aus dem Bondrucker. */
export function QuickPrint() {
  const { user } = useAuth();
  const toast = useToast();
  const isAdmin = user.role === 'admin';
  const [rev, setRev] = useState(0);
  const { data, error } = useLoad(() => api<QuickPrintDto>('GET', '/quickprint'), [rev]);
  const [busy, setBusy] = useState<string | null>(null);
  const [copies, setCopies] = useState(1);
  const [edit, setEdit] = useState<QuickSlipDto | 'new' | null>(null);
  const [free, setFree] = useState({ title: '', text: '' });
  const [suggest, setSuggest] = useState(false);
  const reload = () => setRev((r) => r + 1);

  const print = async (s: QuickSlipDto) => {
    setBusy(s.id);
    try { await api('POST', '/quickprint/print', { id: s.id, copies }); toast(`„${s.title}“ gedruckt${copies > 1 ? ` (${copies}×)` : ''}`); }
    catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
    setBusy(null);
  };
  const f = useSubmit(quickTextInput, async (d) => { await api('POST', '/quickprint/text', d); toast('Text gedruckt'); });

  return (
    <>
      <PageHeader title="Schnelldruck" sub="Info-Zettel für Gäste – ein Tipp, und der Bon kommt aus dem Drucker"
        actions={<>
          <label className="inlinefield">Anzahl <select value={copies} onChange={(e) => setCopies(Number(e.target.value))} aria-label="Anzahl der Ausdrucke">{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}×</option>)}</select></label>
          {isAdmin && <Button onClick={() => setSuggest(true)}>Vorschläge</Button>}
          {isAdmin && <Button onClick={() => setEdit('new')}>Eigenen Zettel anlegen</Button>}
        </>} />
      <LoadState error={error} loading={!data} />
      {data && (
        <>
          {data.printerReady
            ? <p className="muted">Gedruckt wird auf: <b>{data.printerName}</b>{data.printerName === 'Küchendrucker' && ' – für einen eigenen Drucker an der Theke: Verwaltung → Einstellungen → Bondrucker vorne'}.</p>
            : <p className="notice warn">Es ist noch kein Bondrucker eingerichtet. {isAdmin ? 'Das geht unter Verwaltung → Einstellungen → Bondrucker vorne.' : 'Das richtet der Administrator ein.'}</p>}
          <div className="slips">
            {data.slips.map((s) => (
              <section key={s.id} className="card slip">
                <div className="cardhead"><h2>{s.title}</h2>{(s.custom || s.review) && isAdmin && <button type="button" className="linkbtn" onClick={() => setEdit(s)}>{s.review && !s.review.url ? 'Link eintragen' : 'ändern'}</button>}</div>
                <pre className="bon">{s.preview}</pre>
                {s.hint && <p className="muted small">{s.hint}</p>}
                <Button variant="primary" busy={busy === s.id} disabled={!data.printerReady || (!!s.review && !s.review.url) || (s.custom && !!s.hint)} onClick={() => void print(s)}>Drucken</Button>
              </section>
            ))}
            <form className="card slip" onSubmit={(e) => void f.submit({ ...free, copies }, e)} noValidate>
              <h2>Freier Text</h2>
              <Field label="Überschrift" error={f.errors.title}><input value={free.title} onChange={(e) => setFree({ ...free, title: e.target.value })} /></Field>
              <Field label="Text" error={f.errors.text} hint="z. B. eine Wegbeschreibung oder die Taxi-Nummer – wird einmal gedruckt und nicht gespeichert"><textarea rows={6} value={free.text} onChange={(e) => setFree({ ...free, text: e.target.value })} /></Field>
              <Button type="submit" variant="primary" busy={f.busy} disabled={!data.printerReady}>Drucken</Button>
            </form>
          </div>
          <p className="muted small">Öffnungszeiten, Telefon und Adresse stammen aus Verwaltung → Einstellungen → Hotel; der WLAN-Zettel erscheint, sobald unter Internet das Gäste-WLAN hinterlegt ist. Die Vorschau zeigt den Text ungefähr so, wie er auf dem Bon steht.</p>
        </>
      )}
      {suggest && <SuggestDialog onClose={() => setSuggest(false)} onDone={() => { setSuggest(false); reload(); }} />}
      {edit && edit !== 'new' && edit.review && <ReviewDialog slip={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reload(); }} />}
      {edit && (edit === 'new' || !edit.review) && <TemplateDialog slip={edit === 'new' ? null : edit} count={data?.slips.length ?? 0} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reload(); }} />}
    </>
  );
}

function TemplateDialog({ slip, count, onClose, onDone }: { slip: QuickSlipDto | null; count: number; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [v, setV] = useState({ title: slip?.title ?? '', body: slip?.body ?? '', sort: String(slip?.sort ?? count + 1) });
  const f = useSubmit(printTemplateInput, async (d) => {
    await api(slip ? 'PUT' : 'POST', slip ? `/quickprint/templates/${slip.id}` : '/quickprint/templates', slip ? { ...d, version: slip.version } : d);
    toast('Gespeichert');
    onDone();
  });
  const send = (e?: React.FormEvent) => void f.submit({ title: v.title, body: v.body, sort: v.sort.trim() === '' ? NaN : Number(v.sort) }, e);
  const remove = async () => {
    if (!slip || !window.confirm(`Zettel „${slip.title}“ löschen?`)) return;
    try { await api('POST', `/quickprint/templates/${slip.id}/remove`); toast('Gelöscht'); onDone(); } catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
  };
  return (
    <Dialog title={slip ? 'Zettel bearbeiten' : 'Eigenen Zettel anlegen'} onClose={onClose}
      footer={<>{slip && <Button variant="danger" className="left" onClick={() => void remove()}>Löschen</Button>}<Button onClick={onClose}>Abbrechen</Button><Button variant="primary" busy={f.busy} onClick={() => send()}>Speichern</Button></>}>
      <form className="formgrid" onSubmit={send} noValidate>
        <Field label="Überschrift" error={f.errors.title} wide hint="z. B. Taxi, Ärztlicher Notdienst, Ausflugstipps, Frühstückszeiten"><input value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} autoFocus /></Field>
        <Field label="Text" error={f.errors.body} wide hint="Hotelname und Adresse stehen automatisch oben, Telefon und E-Mail unten."><textarea rows={8} value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} /></Field>
        <Field label="Reihenfolge" error={f.errors.sort} hint="kleine Zahl zuerst"><input inputMode="numeric" value={v.sort} onChange={(e) => setV({ ...v, sort: e.target.value })} /></Field>
      </form>
    </Dialog>
  );
}

/** Bewertungs-Zettel: Link zur Google-Bewertung und Texte. */
function ReviewDialog({ slip, onClose, onDone }: { slip: QuickSlipDto; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [v, setV] = useState({ ...slip.review! });
  const f = useSubmit(reviewSlipInput, async (d) => { await api('PUT', '/quickprint/review', d); toast('Gespeichert'); onDone(); });
  return (
    <Dialog title="Bitte um Google-Bewertung" onClose={onClose}
      footer={<><Button onClick={onClose}>Abbrechen</Button><Button variant="primary" busy={f.busy} onClick={() => void f.submit(v)}>Speichern</Button></>}>
      <form className="formgrid" onSubmit={(e) => void f.submit(v, e)} noValidate>
        <Field label="Link zur Google-Bewertung" error={f.errors.url} wide hint="In Ihrem Google-Unternehmensprofil unter „Rezensionen“ → „Mehr Rezensionen erhalten“ den Link kopieren und hier einfügen (beginnt meist mit https://g.page/r/…).">
          <input type="url" value={v.url} onChange={(e) => setV({ ...v, url: e.target.value.trim() })} placeholder="https://g.page/r/…/review" autoFocus />
        </Field>
        <Field label="Überschrift" error={f.errors.headline} wide><input value={v.headline} onChange={(e) => setV({ ...v, headline: e.target.value })} /></Field>
        <Field label="Text" error={f.errors.text} wide><textarea rows={3} value={v.text} onChange={(e) => setV({ ...v, text: e.target.value })} /></Field>
        <Field label="Dank am Ende" error={f.errors.thanks} wide hint="Leere Felder werden mit dem Standardtext gefüllt."><input value={v.thanks} onChange={(e) => setV({ ...v, thanks: e.target.value })} /></Field>
      </form>
    </Dialog>
  );
}

/** Vorschläge für eigene Zettel: auswählen und übernehmen, danach über „ändern“ mit den eigenen Angaben füllen. */
function SuggestDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { data, error } = useLoad(() => api<SlipSuggestionDto[]>('GET', '/quickprint/suggestions'));
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    try { const r = await api<{ added: number }>('POST', '/quickprint/suggestions', { keys: picked }); toast(`${r.added} ${r.added === 1 ? 'Zettel' : 'Zettel'} übernommen`); onDone(); }
    catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); setBusy(false); }
  };
  return (
    <Dialog title="Vorschläge für Info-Zettel" onClose={onClose} size="lg"
      footer={<><Button onClick={onClose}>Abbrechen</Button><Button variant="primary" busy={busy} disabled={picked.length === 0} onClick={() => void add()}>Ausgewählte übernehmen</Button></>}>
      {!data ? <LoadState error={error} loading /> : data.length === 0 ? <p className="muted">Alle Vorschläge sind bereits übernommen.</p> : (
        <>
          <p className="muted">Übernommene Zettel können Sie danach über „ändern“ anpassen. Stellen mit „(bitte eintragen)“ füllen Sie mit Ihren eigenen Angaben – vorher lässt sich der Zettel nicht drucken.</p>
          <div className="suggestions">{data.map((s) => (
            <label key={s.key} className="check">
              <input type="checkbox" checked={picked.includes(s.key)} onChange={(e) => setPicked(e.target.checked ? [...picked, s.key] : picked.filter((k) => k !== s.key))} />
              <span><b>{s.title}</b><small className="pre">{s.body}</small></span>
            </label>
          ))}</div>
        </>
      )}
    </Dialog>
  );
}
