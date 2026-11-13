import { useState } from 'react';
import { printTemplateInput, quickTextInput, type QuickPrintDto, type QuickSlipDto } from '../../../src/shared/schemas.js';
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
                <div className="cardhead"><h2>{s.title}</h2>{s.custom && isAdmin && <button type="button" className="linkbtn" onClick={() => setEdit(s)}>ändern</button>}</div>
                <pre className="bon">{s.preview}</pre>
                {s.hint && <p className="muted small">{s.hint}</p>}
                <Button variant="primary" busy={busy === s.id} disabled={!data.printerReady} onClick={() => void print(s)}>Drucken</Button>
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
      {edit && <TemplateDialog slip={edit === 'new' ? null : edit} count={data?.slips.length ?? 0} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reload(); }} />}
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
