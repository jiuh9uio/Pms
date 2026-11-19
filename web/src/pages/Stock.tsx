import { useState } from 'react';
import { STOCK_KIND_LABEL, stockEmptiesInput, stockReceiptInput, type StockMoveDto, type StockOpenDto, type StockOverviewDto } from '../../../src/shared/schemas.js';
import { todayBerlin } from '../../../src/shared/hotel.js';
import { api } from '../api.ts';
import { deDate } from '../hotel/common.tsx';
import { Button, Dialog, Field, LoadState, useLoad, useSubmit, useToast } from '../ui.tsx';

const num = (s: string) => (s.trim() === '' ? 0 : Number(s.replace(',', '.')));
type Counts = Record<string, string>;
type Extra = { qty: string; article: string };

/** Artikel mit + / − und freie Zusatzzeilen; liefert die Zeilen für den Server. */
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
            <input value={x.article} placeholder="weiterer Artikel, z. B. Kiste Apfelschorle" aria-label="weiterer Artikel" onChange={(e) => onExtra(extra.map((y, j) => (j === i ? { ...y, article: e.target.value } : y)))} />
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

/** Warenzugang: was der Lieferant gebracht hat – und welches Leergut er gleich mitgenommen hat. */
export function StockReceipt() {
  const toast = useToast();
  const { data, error, reload } = useStock();
  const empty = () => ({ date: todayBerlin(), supplier: '', ref: '', note: '', counts: {} as Counts, extra: [] as Extra[], eCounts: {} as Counts, eExtra: [] as Extra[] });
  const [v, setV] = useState(empty);
  const f = useSubmit(stockReceiptInput, async (d) => {
    await api('POST', '/stock/receipts', d);
    toast('Warenzugang gespeichert');
    setV(empty());
    reload();
  });
  if (!data) return <LoadState error={error} loading />;
  const send = (e?: React.FormEvent) => void f.submit({
    date: v.date, supplier: v.supplier, ref: v.ref, note: v.note,
    lines: toLines(data.articles, v.counts, v.extra), empties: toLines(data.articles, v.eCounts, v.eExtra),
  }, e);
  return (
    <>
      <section className="card">
        <h2>Ware ist gekommen</h2>
        <p className="muted small">Zum Beispiel: Die Brauerei bringt volle Fässer und nimmt Leergut mit. Die Fässer zählen dann unter „Leergut“ als „beim Lieferanten noch zurückzugeben“.</p>
        <form className="formgrid" onSubmit={send} noValidate>
          <Field label="Lieferant" error={f.errors.supplier} hint="z. B. Name der Brauerei oder des Getränkehändlers">
            <input value={v.supplier} list="stock-suppliers" onChange={(e) => setV({ ...v, supplier: e.target.value })} />
          </Field>
          <datalist id="stock-suppliers">{data.suppliers.map((s) => <option key={s} value={s} />)}</datalist>
          <Field label="Datum" error={f.errors.date}><input type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} /></Field>
          <Field label="Lieferschein-Nr. des Lieferanten" error={f.errors.ref} hint="freiwillig"><input value={v.ref} onChange={(e) => setV({ ...v, ref: e.target.value })} /></Field>
          <ArticlePicker idp="Erhalten" label="Erhalten (volle Ware)" articles={data.articles} counts={v.counts} extra={v.extra} onCounts={(c) => setV({ ...v, counts: c })} onExtra={(x) => setV({ ...v, extra: x })} error={errOf(f.errors, 'lines')} />
          <ArticlePicker idp="Leergut" label="Leergut gleich mitgegeben (freiwillig)" articles={data.articles} counts={v.eCounts} extra={v.eExtra} onCounts={(c) => setV({ ...v, eCounts: c })} onExtra={(x) => setV({ ...v, eExtra: x })} error={errOf(f.errors, 'empties')} />
          <Field label="Hinweis" error={f.errors.note} wide hint="freiwillig, z. B. Fass beschädigt, Nachlieferung folgt"><textarea rows={2} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></Field>
          <div className="wide"><Button type="submit" variant="primary" busy={f.busy}>Warenzugang speichern</Button></div>
        </form>
        <p className="muted small">Die Kontrolle für das Hygieneamt (Temperatur, Zustand) bleibt wie bisher unter Kontrollen → Hygieneamt → Wareneingang.</p>
      </section>
      <History moves={data.recent} onChange={reload} />
    </>
  );
}

/** Leergut: was noch bei Kunden steht und was noch an Lieferanten zurückgeht. */
export function StockEmpties() {
  const { data, error, reload } = useStock();
  const [ret, setRet] = useState<{ kind: 'empty_back' | 'empty_return'; partner: string; open: StockOpenDto[] } | null>(null);
  if (!data) return <LoadState error={error} loading />;
  const group = (list: StockOpenDto[]) => [...new Set(list.map((o) => o.partner))].map((p) => ({ partner: p, open: list.filter((o) => o.partner === p) }));
  const block = (title: string, hint: string, list: StockOpenDto[], kind: 'empty_back' | 'empty_return', button: string, none: string) => (
    <section className="card">
      <h2>{title}</h2>
      <p className="muted small">{hint}</p>
      {list.length === 0 ? <p className="muted">{none}</p> : (
        <div className="tablewrap"><table className="temps">
          <thead><tr><th>{kind === 'empty_back' ? 'Kunde' : 'Lieferant'}</th><th>Artikel</th><th>offen</th><th>seit</th><th /></tr></thead>
          <tbody>{group(list).map((g) => g.open.map((o, i) => (
            <tr key={`${g.partner}|${o.article}`}>
              <td>{i === 0 ? <b>{g.partner}</b> : ''}</td><td>{o.article}</td><td><b>{o.qty}</b></td><td>{o.since ? deDate(o.since) : '–'}</td>
              <td>{i === 0 && <Button onClick={() => setRet({ kind, partner: g.partner, open: g.open })}>{button}</Button>}</td>
            </tr>
          )))}</tbody>
        </table></div>
      )}
    </section>
  );
  return (
    <>
      {block('Bei Kunden draußen', 'Kommt automatisch aus den gedruckten Lieferscheinen. Wenn das Leergut zurück ist: „zurückbekommen“ tippen.', data.customers, 'empty_back', 'zurückbekommen', 'Zurzeit ist nichts bei Kunden draußen.')}
      {block('Beim Lieferanten noch zurückzugeben', 'Aus dem Warenzugang: erhaltene Fässer, die noch nicht als Leergut an den Lieferanten zurückgegangen sind.', data.atSuppliers, 'empty_return', 'zurückgegeben', 'Beim Lieferanten ist nichts offen.')}
      <p className="muted small">Nur Stückzahlen – Pfand in Euro wird noch nicht berechnet.</p>
      <History moves={data.recent} onChange={reload} />
      {ret && <ReturnDialog {...ret} onClose={() => setRet(null)} onDone={() => { setRet(null); reload(); }} />}
    </>
  );
}

function ReturnDialog({ kind, partner, open, onClose, onDone }: { kind: 'empty_back' | 'empty_return'; partner: string; open: StockOpenDto[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [counts, setCounts] = useState<Counts>(Object.fromEntries(open.map((o) => [o.article, String(o.qty)])));
  const [date, setDate] = useState(todayBerlin());
  const [note, setNote] = useState('');
  const f = useSubmit(stockEmptiesInput, async (d) => { await api('POST', '/stock/empties', d); toast('Leergut gespeichert'); onDone(); });
  const send = () => void f.submit({ kind, partner, date, note, lines: open.map((o) => ({ qty: num(counts[o.article] ?? ''), article: o.article })).filter((l) => l.qty !== 0) });
  return (
    <Dialog title={kind === 'empty_back' ? `Leergut zurück von ${partner}` : `Leergut an ${partner} zurückgegeben`} onClose={onClose}
      footer={<><Button onClick={onClose}>Abbrechen</Button><Button variant="primary" busy={f.busy} onClick={send}>Speichern</Button></>}>
      <p className="muted small">Vorgeschlagen ist alles, was offen ist. Kam weniger zurück, die Zahl einfach verkleinern – der Rest bleibt offen.</p>
      <div className="deliveryarticles">
        {open.map((o) => (
          <div key={o.article}>
            <span>{o.article} <small className="muted">(offen: {o.qty})</small></span>
            <span className="dlstep"><input inputMode="numeric" value={counts[o.article] ?? ''} aria-label={`Anzahl ${o.article}`} onChange={(e) => setCounts({ ...counts, [o.article]: e.target.value })} /></span>
          </div>
        ))}
      </div>
      {errOf(f.errors, 'lines') && <p className="error">{errOf(f.errors, 'lines')}</p>}
      <div className="formgrid">
        <Field label="Datum" error={f.errors.date}><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Hinweis" error={f.errors.note} hint="freiwillig, z. B. ein Fass fehlt"><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Dialog>
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
        <thead><tr><th>Datum</th><th>Vorgang</th><th>Kunde / Lieferant</th><th>Artikel</th><th>Anzahl</th><th>Beleg</th><th>von</th><th /></tr></thead>
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
