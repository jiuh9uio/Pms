import { useEffect, useState, type ReactNode } from 'react';
import { mailSendInput, type MailDraft } from '../../../src/shared/hotel.js';
import { api } from '../api.ts';
import { Button, Dialog, Field, LoadState, useLoad, useSubmit, useToast } from '../ui.tsx';

/** E-Mail an den Gast: Vorschlag laden, anpassen, senden. path = /bookings/<id>/mail oder /invoices/<id>/mail?kind=invoice|reminder */
export function MailDialog({ path, title, onClose, onSent, beforeSend, sendLabel = 'Senden', extra, intro }: {
  path: string; title: string; onClose: () => void; onSent?: () => void;
  /** wird unmittelbar vor dem Senden ausgeführt (z. B. Zusage buchen); schlägt es fehl, wird nicht gesendet */
  beforeSend?: () => Promise<void>; sendLabel?: string; extra?: ReactNode; intro?: ReactNode;
}) {
  const toast = useToast();
  const { data, error } = useLoad(() => api<MailDraft>('GET', path), [path]);
  const [v, setV] = useState<{ to: string; subject: string; text: string } | null>(null);
  useEffect(() => { if (data) setV({ to: data.to, subject: data.subject, text: data.text }); }, [data]);
  const f = useSubmit(mailSendInput, async (d) => {
    if (beforeSend) await beforeSend();
    try { await api('POST', path, d); }
    catch (e) { throw new Error(`${beforeSend ? 'Zugesagt, aber die E-Mail wurde nicht gesendet: ' : ''}${e instanceof Error ? e.message : 'Fehler'}`); }
    toast(`E-Mail an ${d.to} gesendet`);
    onSent?.();
    onClose();
  });
  return (
    <Dialog title={title} onClose={onClose} size="lg"
      footer={<><Button onClick={onClose}>Abbrechen</Button>{extra}<Button variant="primary" busy={f.busy} disabled={!v || !data?.ready} onClick={() => v && void f.submit(v)}>{sendLabel}</Button></>}>
      {!v || !data ? <LoadState error={error} loading /> : (
        <form onSubmit={(e) => void f.submit(v, e)} noValidate>
          {intro}
          {!data.ready && <p className="notice warn">Der E-Mail-Versand ist noch nicht eingerichtet. Ein Administrator kann das Postfach unter Verwaltung → Einstellungen → E-Mail-Versand hinterlegen.</p>}
          <div className="formgrid">
            <Field label="An" error={f.errors.to} wide hint={data.to ? undefined : 'Es ist keine E-Mail-Adresse hinterlegt'}><input type="email" value={v.to} onChange={(e) => setV({ ...v, to: e.target.value })} /></Field>
            <Field label="Betreff" error={f.errors.subject} wide><input value={v.subject} onChange={(e) => setV({ ...v, subject: e.target.value })} /></Field>
            <Field label="Text" error={f.errors.text} wide><textarea rows={14} value={v.text} onChange={(e) => setV({ ...v, text: e.target.value })} /></Field>
          </div>
          {data.attachment && <p className="muted small">Anhang: {data.attachment} (die Rechnung als PDF, wie sie im Rechnungsarchiv liegt)</p>}
        </form>
      )}
    </Dialog>
  );
}
