import { useState } from 'react';
import { deliveryArticlesInput, deliveryNoteInput, type DeliveryNoteDto, type DeliveryOverviewDto } from '../../../src/shared/schemas.js';
import { todayBerlin } from '../../../src/shared/hotel.js';
import { api } from '../api.ts';
import { deDate } from '../hotel/common.tsx';
import { Button, Dialog, Field, LoadState, useLoad, useSubmit, useToast } from '../ui.tsx';

type Extra = { qty: string; article: string };
const num = (s: string) => (s.trim() === '' ? 0 : Number(s.replace(',', '.')));

/** Lieferschein auf dem Bondrucker – z. B. Fassbier für eine Feier. Feste Artikel antippen, Menge eintragen, drucken. */
export function DeliveryNoteCard({ printerReady, isAdmin }: { printerReady: boolean; isAdmin: boolean }) {
  const toast = useToast();
  const [rev, setRev] = useState(0);
  const { data, error } = useLoad(() => api<DeliveryOverviewDto>('GET', '/delivery-notes'), [rev]);
  const empty = () => ({ recipient: '', address: '', date: todayBerlin(), returnBy: '', note: '', copies: 2, qty: {} as Record<string, string>, extra: [] as Extra[] });
  const [v, setV] = useState(empty);
  const [articles, setArticles] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const reload = () => setRev((r) => r + 1);

  const f = useSubmit(deliveryNoteInput, async (d) => {
    const r = await api<{ number: string }>('POST', '/delivery-notes', d);
    toast(`Lieferschein ${r.number} gedruckt`);
    setV(empty());
    reload();
  });
  const send = (e?: React.FormEvent) => {
    const lines = [
      ...(data?.articles ?? []).map((a) => ({ qty: num(v.qty[a] ?? ''), article: a })).filter((l) => l.qty !== 0),
      ...v.extra.filter((x) => x.article.trim() || x.qty.trim()).map((x) => ({ qty: num(x.qty), article: x.article })),
    ];
    void f.submit({ recipient: v.recipient, address: v.address, date: v.date, returnBy: v.returnBy, note: v.note, copies: v.copies, lines }, e);
  };
  const reprint = async (n: DeliveryNoteDto) => {
    setBusy(n.auditId);
    try { await api('POST', `/delivery-notes/${n.auditId}/reprint`); toast(`${n.number} nachgedruckt`); } catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
    setBusy(null);
  };
  const lineError = Object.entries(f.errors).find(([k]) => k.startsWith('lines'))?.[1];

  return (
    <section className="card deliverynote">
      <div className="cardhead"><h2>Lieferschein</h2>{isAdmin && <button type="button" className="linkbtn" onClick={() => setArticles(true)}>Artikel ändern</button>}</div>
      <p className="muted small">Zum Beispiel für Fassbier zu einer Feier. Gedruckt wird auf dem Bondrucker, mit fortlaufender Nummer (LS-Jahr-Nummer) und einem Feld für die Unterschrift „Ware erhalten“. Ein Lieferschein ist keine Rechnung.</p>
      <LoadState error={error} loading={!data} />
      {data && (
        <div className="deliverygrid">
          <form className="formgrid" onSubmit={send} noValidate>
            <Field label="Empfänger" error={f.errors.recipient} wide hint="Name oder Verein/Firma"><input value={v.recipient} onChange={(e) => setV({ ...v, recipient: e.target.value })} /></Field>
            <Field label="Lieferanschrift" error={f.errors.address} wide hint="freiwillig"><textarea rows={2} value={v.address} onChange={(e) => setV({ ...v, address: e.target.value })} /></Field>
            <Field label="Lieferdatum" error={f.errors.date}><input type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} /></Field>
            <Field label="Leergut zurück bis" error={f.errors.returnBy} hint="freiwillig"><input type="date" value={v.returnBy} onChange={(e) => setV({ ...v, returnBy: e.target.value })} /></Field>
            <div className="field wide">
              <span className="label" id="dl-ware">Ware (Anzahl eintragen)</span>
              <div className="deliveryarticles">
                {data.articles.map((a) => (
                  <div key={a} className={num(v.qty[a] ?? '') > 0 ? 'on' : ''}>
                    <span>{a}</span>
                    <span className="dlstep">
                      <button type="button" aria-label={`${a} weniger`} onClick={() => setV({ ...v, qty: { ...v.qty, [a]: String(Math.max(0, num(v.qty[a] ?? '') - 1) || '') } })}>−</button>
                      <input inputMode="numeric" value={v.qty[a] ?? ''} placeholder="0" aria-label={`Anzahl ${a}`} onChange={(e) => setV({ ...v, qty: { ...v.qty, [a]: e.target.value } })} />
                      <button type="button" aria-label={`${a} mehr`} onClick={() => setV({ ...v, qty: { ...v.qty, [a]: String(num(v.qty[a] ?? '') + 1) } })}>+</button>
                    </span>
                  </div>
                ))}
                {v.extra.map((x, i) => (
                  <div key={i} className="extra">
                    <input value={x.article} placeholder="weitere Ware, z. B. Zapfanlage" aria-label="weitere Ware" onChange={(e) => setV({ ...v, extra: v.extra.map((y, j) => (j === i ? { ...y, article: e.target.value } : y)) })} />
                    <input inputMode="numeric" className="qty" value={x.qty} placeholder="Anz." aria-label="Anzahl" onChange={(e) => setV({ ...v, extra: v.extra.map((y, j) => (j === i ? { ...y, qty: e.target.value } : y)) })} />
                    <button type="button" className="linkbtn" onClick={() => setV({ ...v, extra: v.extra.filter((_, j) => j !== i) })}>entfernen</button>
                  </div>
                ))}
              </div>
              <button type="button" className="linkbtn" onClick={() => setV({ ...v, extra: [...v.extra, { qty: '1', article: '' }] })}>+ weitere Position</button>
              {lineError && <span className="error">{lineError}</span>}
            </div>
            <Field label="Hinweis" error={f.errors.note} wide hint="freiwillig, z. B. Fassnummern, Zapfanlage, Abholung"><textarea rows={2} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></Field>
            <Field label="Ausdrucke" hint="2 = ein Exemplar für den Empfänger und eines, das unterschrieben zurückkommt">
              <select value={v.copies} onChange={(e) => setV({ ...v, copies: Number(e.target.value) })}>
                <option value={1}>1 (zum Unterschreiben)</option><option value={2}>2 (Empfänger + Unterschrift)</option><option value={3}>3</option>
              </select>
            </Field>
            <div className="wide"><Button type="submit" variant="primary" busy={f.busy} disabled={!printerReady}>Lieferschein drucken</Button></div>
          </form>
          <div>
            <h3 className="small muted">So sieht der Bon ungefähr aus (Beispiel)</h3>
            <pre className="bon">{data.preview}</pre>
          </div>
        </div>
      )}
      {data && data.recent.length > 0 && (
        <details className="deliveryrecent">
          <summary>Zuletzt gedruckt ({data.recent.length})</summary>
          <div className="tablewrap"><table className="temps">
            <thead><tr><th>Nr.</th><th>Lieferdatum</th><th>Empfänger</th><th>Ware</th><th>von</th><th /></tr></thead>
            <tbody>{data.recent.map((n) => (
              <tr key={n.auditId}>
                <td>{n.number}</td><td>{deDate(n.date)}</td><td>{n.recipient}</td>
                <td>{n.lines.map((l) => `${l.qty}× ${l.article}`).join(', ')}</td><td>{n.userName}</td>
                <td><Button busy={busy === n.auditId} disabled={!printerReady} onClick={() => void reprint(n)}>Nachdruck</Button></td>
              </tr>
            ))}</tbody>
          </table></div>
        </details>
      )}
      {articles && data && <ArticlesDialog articles={data.articles} onClose={() => setArticles(false)} onDone={() => { setArticles(false); reload(); }} />}
    </section>
  );
}

function ArticlesDialog({ articles, onClose, onDone }: { articles: string[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [text, setText] = useState(articles.join('\n'));
  const f = useSubmit(deliveryArticlesInput, async (d) => { await api('PUT', '/delivery-notes/articles', d); toast('Artikel gespeichert'); onDone(); });
  const send = () => void f.submit({ articles: text.split('\n').map((s) => s.trim()).filter(Boolean) });
  return (
    <Dialog title="Artikel für Lieferscheine" onClose={onClose}
      footer={<><Button onClick={onClose}>Abbrechen</Button><Button variant="primary" busy={f.busy} onClick={send}>Speichern</Button></>}>
      <Field label="Ein Artikel pro Zeile" error={Object.values(f.errors)[0]} wide hint="z. B. „Pils – Fass 50 l“. Diese Artikel erscheinen als Schnellauswahl.">
        <textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
      </Field>
    </Dialog>
  );
}
