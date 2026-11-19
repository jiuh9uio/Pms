import { useState } from 'react';
import { STOCK_KIND_LABEL, stockArticlesInput, stockEmptiesInput, stockReceiptInput, type StockBonDto, type StockMoveDto, type StockOverviewDto, type StockSaveResult } from '../../../src/shared/schemas.js';
import { todayBerlin } from '../../../src/shared/hotel.js';
import { api } from '../api.ts';
import { useAuth } from '../App.tsx';
import { deDate } from '../hotel/common.tsx';
import { Button, Dialog, Field, LoadState, useLoad, useSubmit, useToast } from '../ui.tsx';

const num = (s: string) => (s.trim() === '' ? 0 : Number(s.replace(',', '.')));
type Counts = Record<string, string>;
type Extra = { qty: string; article: string };

/** Artikel mit + / − und freie Zusatzzeilen. */
function ArticlePicker({ label, articles, counts, extra, onCounts, onExtra, error, idp }: {
  label: string; articles: string[]; counts: Counts; extra: Extra[]; onCounts: (c: Counts) => void; onExtra: (e: Extra[]) => void; error?: string; idp: string;
}) {
  const set = (a: string, n: number) => onCounts({ ...counts, [a]: n > 0 ? String(n) : '' });
  return (
    <div className="field wide">
      <span className="label">{label}</span>
      <div className="deliveryarticles">
        {articles.map((a) => (
          <div key={a} className={num(counts[a] ?? '') > 0 ? 'on' : ''}>
            <span>{a}</span>
            <span className="dlstep">
              <button type="button" aria-label={`${idp}: ${a} weniger`} onClick={() => set(a, Math.max(0, num(counts[a] ?? '') - 1))}>−</button>
              <input inputMode="numeric" value={counts[a] ?? ''} placeholder="0" aria-label={`${idp}: Anzahl ${a}`} onChange={(e) => onCounts({ ...counts, [a]: e.target.value })} />
              <button type="button" aria-label={`${idp}: ${a} mehr`} onClick={() => set(a, num(counts[a] ?? '') + 1)}>+</button>
            </span>
          </div>
        ))}
        {extra.map((x, i) => (
          <div key={i} className="extra">
            <input value={x.article} placeholder="weiterer Artikel, z. B. Kiste Mineralwasser" aria-label="weiterer Artikel" onChange={(e) => onExtra(extra.map((y, j) => (j === i ? { ...y, article: e.target.value } : y)))} />
            <input inputMode="numeric" className="qty" value={x.qty} placeholder="Anz." aria-label="Anzahl" onChange={(e) => onExtra(extra.map((y, j) => (j === i ? { ...y, qty: e.target.value } : y)))} />
            <button type="button" className="linkbtn" onClick={() => onExtra(extra.filter((_, j) => j !== i))}>entfernen</button>
          </div>
        ))}
      </div>
      <button type="button" className="linkbtn" onClick={() => onExtra([...extra, { qty: '1', article: '' }])}>+ weiterer Artikel</button>
      {error && <span className="error">{error}</span>}
    </div>
  );
}
const toLines = (articles: string[], counts: Counts, extra: Extra[]) => [
  ...articles.map((a) => ({ qty: num(counts[a] ?? ''), article: a })).filter((l) => l.qty !== 0),
  ...extra.filter((x) => x.article.trim() || x.qty.trim()).map((x) => ({ qty: num(x.qty), article: x.article })),
];
const errOf = (errors: Record<string, string>, prefix: string) => Object.entries(errors).find(([k]) => k.startsWith(prefix))?.[1];

function useStock() {
  const [rev, setRev] = useState(0);
  const load = useLoad(() => api<StockOverviewDto>('GET', '/stock'), [rev]);
  return { ...load, reload: () => setRev((r) => r + 1) };
}
function useSaved() {
  const toast = useToast();
  return (what: string, r: StockSaveResult, print: boolean) => {
    if (!print) toast(`${what} ${r.number} gespeichert`);
    else if (r.printed) toast(`${what} ${r.number} gespeichert und Bon gedruckt`);
    else toast(`${what} ${r.number} ist gespeichert, aber der Bon wurde nicht gedruckt: ${r.printError ?? 'Druckfehler'}. Nachdruck unten unter „Bons“.`, 'error');
  };
}
function PrinterLine({ data }: { data: StockOverviewDto }) {
  const { user } = useAuth();
  return data.printerReady
    ? <p className="muted small">Bon wird gedruckt auf: <b>{data.printerName}</b>.</p>
    : <p className="notice warn">Es ist noch kein Bondrucker eingerichtet – speichern geht trotzdem. {user.role === 'admin' ? 'Einrichten unter Verwaltung → Einstellungen → Bondrucker vorne.' : 'Das richtet der Administrator ein.'}</p>;
}
function SupplierField({ value, onChange, error, suppliers }: { value: string; onChange: (s: string) => void; error?: string; suppliers: string[] }) {
  return (
    <>
      <Field label="Lieferant" error={error} hint="z. B. Name der Brauerei oder des Getränkehändlers">
        <input value={value} list="stock-suppliers" onChange={(e) => onChange(e.target.value)} />
      </Field>
      <datalist id="stock-suppliers">{suppliers.map((s) => <option key={s} value={s} />)}</datalist>
    </>
  );
}

/** Warenzugang: was der Lieferant gebracht hat – und welches Leergut der Fahrer gleich mitgenommen hat. */
export function StockReceipt() {
  const { data, error, reload } = useStock();
  const saved = useSaved();
  const empty = () => ({ date: todayBerlin(), supplier: '', ref: '', note: '', counts: {} as Counts, extra: [] as Extra[], eCounts: {} as Counts, eExtra: [] as Extra[], print: true });
  const [v, setV] = useState(empty);
  const [articles, setArticles] = useState(false);
  const { user } = useAuth();
  const f = useSubmit(stockReceiptInput, async (d) => {
    const r = await api<StockSaveResult>('POST', '/stock/receipts', d);
    saved('Warenzugang', r, d.print);
    setV({ ...empty(), print: v.print });
    reload();
  });
  if (!data) return <LoadState error={error} loading />;
  const send = (e?: React.FormEvent) => void f.submit({
    date: v.date, supplier: v.supplier, ref: v.ref, note: v.note, print: v.print && data.printerReady,
    lines: toLines(data.articles, v.counts, v.extra), empties: toLines(data.articles, v.eCounts, v.eExtra),
  }, e);
  const hasEmpties = toLines(data.articles, v.eCounts, v.eExtra).length > 0;
  return (
    <>
      <section className="card">
        <div className="cardhead"><h2>Ware ist gekommen</h2>{user.role === 'admin' && <button type="button" className="linkbtn" onClick={() => setArticles(true)}>Artikel ändern</button>}</div>
        <p className="muted small">Lieferung eintragen, z. B. von der Brauerei. Nimmt der Fahrer gleich Leergut mit, tragen Sie es unten mit ein – dann kommt auf den Bon ein Feld für seine Unterschrift.</p>
        <PrinterLine data={data} />
        <form className="formgrid" onSubmit={send} noValidate>
          <SupplierField value={v.supplier} onChange={(s) => setV({ ...v, supplier: s })} error={f.errors.supplier} suppliers={data.suppliers} />
          <Field label="Datum" error={f.errors.date}><input type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} /></Field>
          <Field label="Lieferschein-Nr. des Lieferanten" error={f.errors.ref} hint="freiwillig – steht auf dem Papier, das der Fahrer mitbringt"><input value={v.ref} onChange={(e) => setV({ ...v, ref: e.target.value })} /></Field>
          <ArticlePicker idp="Erhalten" label="Erhalten (volle Ware)" articles={data.articles} counts={v.counts} extra={v.extra} onCounts={(c) => setV({ ...v, counts: c })} onExtra={(x) => setV({ ...v, extra: x })} error={errOf(f.errors, 'lines')} />
          <ArticlePicker idp="Leergut" label="Leergut gleich mitgegeben (freiwillig)" articles={data.articles} counts={v.eCounts} extra={v.eExtra} onCounts={(c) => setV({ ...v, eCounts: c })} onExtra={(x) => setV({ ...v, eExtra: x })} error={errOf(f.errors, 'empties')} />
          <Field label="Hinweis" error={f.errors.note} wide hint="freiwillig, z. B. Fass beschädigt, Nachlieferung folgt"><textarea rows={2} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></Field>
          <label className="check wide"><input type="checkbox" checked={v.print && data.printerReady} disabled={!data.printerReady} onChange={(e) => setV({ ...v, print: e.target.checked })} />
            <span>Bon drucken{hasEmpties ? ' (2 Stück: für den Fahrer und für uns)' : ''}</span></label>
          <div className="wide"><Button type="submit" variant="primary" busy={f.busy}>Warenzugang speichern</Button></div>
        </form>
        <p className="muted small">Die Kontrolle für das Hygieneamt (Temperatur, Zustand) bleibt wie bisher unter Kontrollen → Hygieneamt → Wareneingang.</p>
      </section>
      <Bons bons={data.bons} printerReady={data.printerReady} />
      <History moves={data.recent} onChange={reload} />
      {articles && <ArticlesDialog articles={data.articles} onClose={() => setArticles(false)} onDone={() => { setArticles(false); reload(); }} />}
    </>
  );
}

/** Leergut an den Lieferanten zurückgeben – mit Bon, den der Fahrer unterschreibt. */
export function StockEmpties() {
  const { data, error, reload } = useStock();
  const saved = useSaved();
  const empty = () => ({ date: todayBerlin(), supplier: '', note: '', counts: {} as Counts, extra: [] as Extra[], print: true });
  const [v, setV] = useState(empty);
  const f = useSubmit(stockEmptiesInput, async (d) => {
    const r = await api<StockSaveResult>('POST', '/stock/empties', d);
    saved('Leergut-Rückgabe', r, d.print);
    setV({ ...empty(), print: v.print });
    reload();
  });
  if (!data) return <LoadState error={error} loading />;
  const send = (e?: React.FormEvent) => void f.submit({ date: v.date, supplier: v.supplier, note: v.note, print: v.print && data.printerReady, lines: toLines(data.articles, v.counts, v.extra) }, e);
  const open = data.atSuppliers.filter((o) => o.partner.trim().toLowerCase() === v.supplier.trim().toLowerCase());
  return (
    <>
      <section className="card">
        <h2>Leergut abgeben</h2>
        <p className="muted small">Der Fahrer holt Leergut ab: eintragen, Bon drucken, Fahrer unterschreibt. Ein Exemplar bekommt der Fahrer, eines heften Sie ab – so ist das Pfand belegt.</p>
        <PrinterLine data={data} />
        <form className="formgrid" onSubmit={send} noValidate>
          <SupplierField value={v.supplier} onChange={(s) => setV({ ...v, supplier: s })} error={f.errors.supplier} suppliers={data.suppliers} />
          <Field label="Datum" error={f.errors.date}><input type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} /></Field>
          {open.length > 0 && <p className="muted small wide">Laut Programm noch offen bei {open[0]!.partner}: {open.map((o) => `${o.qty}× ${o.article}`).join(', ')}.{' '}
            <button type="button" className="linkbtn" onClick={() => setV({ ...v, counts: Object.fromEntries(open.map((o) => [o.article, String(o.qty)])) })}>alles übernehmen</button></p>}
          <ArticlePicker idp="Leergut" label="Leergut (Anzahl)" articles={data.articles} counts={v.counts} extra={v.extra} onCounts={(c) => setV({ ...v, counts: c })} onExtra={(x) => setV({ ...v, extra: x })} error={errOf(f.errors, 'lines')} />
          <Field label="Hinweis" error={f.errors.note} wide hint="freiwillig, z. B. ein Fass beschädigt"><textarea rows={2} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></Field>
          <label className="check wide"><input type="checkbox" checked={v.print && data.printerReady} disabled={!data.printerReady} onChange={(e) => setV({ ...v, print: e.target.checked })} /><span>Bon drucken (2 Stück: für den Fahrer und für uns)</span></label>
          <div className="wide"><Button type="submit" variant="primary" busy={f.busy}>Leergut-Rückgabe speichern</Button></div>
        </form>
      </section>
      <section className="card">
        <h2>Noch beim Lieferanten offen</h2>
        <p className="muted small">Erhaltene Fässer laut Warenzugang, die noch nicht als Leergut zurückgegangen sind (also noch im Haus, voll oder leer). Nur Stückzahlen, kein Pfand in Euro.</p>
        {data.atSuppliers.length === 0 ? <p className="muted">Nichts offen.</p> : (
          <div className="tablewrap"><table className="temps">
            <thead><tr><th>Lieferant</th><th>Artikel</th><th>offen</th><th>seit</th></tr></thead>
            <tbody>{data.atSuppliers.map((o, i) => (
              <tr key={`${o.partner}|${o.article}`}><td>{i === 0 || data.atSuppliers[i - 1]!.partner !== o.partner ? <b>{o.partner}</b> : ''}</td><td>{o.article}</td><td><b>{o.qty}</b></td><td>{o.since ? deDate(o.since) : '–'}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
      <Bons bons={data.bons} printerReady={data.printerReady} />
      <History moves={data.recent} onChange={reload} />
    </>
  );
}

function Bons({ bons, printerReady }: { bons: StockBonDto[]; printerReady: boolean }) {
  const toast = useToast();
  const [busy, setBusy] = useState<number | null>(null);
  if (!bons.length) return null;
  const again = async (b: StockBonDto) => {
    setBusy(b.auditId);
    try { await api('POST', `/stock/bons/${b.auditId}/reprint`); toast(`${b.number} nachgedruckt`); } catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
    setBusy(null);
  };
  return (
    <details className="card deliveryrecent">
      <summary>Bons (letzte {bons.length}) – Nachdruck</summary>
      <div className="tablewrap"><table className="temps">
        <thead><tr><th>Nr.</th><th>Datum</th><th>Lieferant</th><th>Inhalt</th><th>von</th><th /></tr></thead>
        <tbody>{bons.map((b) => (
          <tr key={b.auditId}><td>{b.number}</td><td>{deDate(b.date)}</td><td>{b.supplier}</td><td>{b.summary}</td><td>{b.userName}</td>
            <td><Button busy={busy === b.auditId} disabled={!printerReady} onClick={() => void again(b)}>Nachdruck</Button></td></tr>
        ))}</tbody>
      </table></div>
    </details>
  );
}

function History({ moves, onChange }: { moves: StockMoveDto[]; onChange: () => void }) {
  const toast = useToast();
  const cancel = async (m: StockMoveDto) => {
    if (!window.confirm(`Eintrag „${m.qty}× ${m.article}“ (${STOCK_KIND_LABEL[m.kind]}, ${m.partner}) stornieren? Er bleibt durchgestrichen sichtbar.`)) return;
    try { await api('POST', `/stock/moves/${m.id}/void`); toast('Storniert'); onChange(); } catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
  };
  if (!moves.length) return null;
  return (
    <details className="card deliveryrecent">
      <summary>Verlauf (letzte {moves.length})</summary>
      <div className="tablewrap"><table className="temps">
        <thead><tr><th>Datum</th><th>Vorgang</th><th>Lieferant</th><th>Artikel</th><th>Anzahl</th><th>Beleg</th><th>von</th><th /></tr></thead>
        <tbody>{moves.map((m) => (
          <tr key={m.id} className={m.voided ? 'off' : ''}>
            <td>{deDate(m.date)}</td><td>{STOCK_KIND_LABEL[m.kind]}</td><td>{m.partner}</td><td>{m.voided ? <s>{m.article}</s> : m.article}</td><td>{m.qty}</td><td>{m.ref || '–'}</td>
            <td>{m.userName}{m.voided && <small className="muted"> · storniert von {m.voidedBy}</small>}</td>
            <td>{!m.voided && <button type="button" className="linkbtn" onClick={() => void cancel(m)}>stornieren</button>}</td>
          </tr>
        ))}</tbody>
      </table></div>
    </details>
  );
}

function ArticlesDialog({ articles, onClose, onDone }: { articles: string[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [text, setText] = useState(articles.join('\n'));
  const f = useSubmit(stockArticlesInput, async (d) => { await api('PUT', '/stock/articles', d); toast('Artikel gespeichert'); onDone(); });
  const send = () => void f.submit({ articles: text.split('\n').map((s) => s.trim()).filter(Boolean) });
  return (
    <Dialog title="Artikel für Warenzugang und Leergut" onClose={onClose}
      footer={<><Button onClick={onClose}>Abbrechen</Button><Button variant="primary" busy={f.busy} onClick={send}>Speichern</Button></>}>
      <Field label="Ein Artikel pro Zeile" error={Object.values(f.errors)[0]} wide hint="z. B. „Pils – Fass 50 l“. Diese Artikel erscheinen als Schnellauswahl.">
        <textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
      </Field>
    </Dialog>
  );
}
