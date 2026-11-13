import { useState } from 'react';
import { goodsReceiptInput, type GoodsReceiptDto } from '../../../src/shared/controls.js';
import { todayBerlin } from '../../../src/shared/hotel.js';
import { api } from '../api.ts';
import { deDate } from '../hotel/common.tsx';
import { Badge, Button, Field, LoadState, printOnly, useLoad, useSubmit, useToast } from '../ui.tsx';

const EMPTY = { supplier: '', goods: '', temp: '', ok: true, note: '' };
const fmtTemp = (t: number | null) => (t == null ? '–' : `${String(t).replace('.', ',')} °C`);

/** Wareneingangskontrolle: je Lieferung ein kurzer Eintrag, Monatsliste zum Ausdrucken. */
export function GoodsReceipts() {
  const toast = useToast();
  const today = todayBerlin();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [rev, setRev] = useState(0);
  const { data, error } = useLoad(() => api<GoodsReceiptDto[]>('GET', `/goods-receipts?month=${month}`), [month, rev]);
  const suppliers = useLoad(() => api<string[]>('GET', '/goods-receipts/suppliers'), [rev]).data ?? [];
  const [v, setV] = useState(EMPTY);
  const f = useSubmit(goodsReceiptInput, async (d) => {
    await api('POST', '/goods-receipts', d);
    toast('Wareneingang eingetragen');
    setV(EMPTY);
    setMonth(today.slice(0, 7));
    setRev((r) => r + 1);
  });
  const send = (e?: React.FormEvent) => {
    const t = v.temp.trim();
    void f.submit({ supplier: v.supplier, goods: v.goods, tempC: t === '' ? null : Number(t.replace(',', '.')), ok: v.ok, note: v.note }, e);
  };
  const remove = async (r: GoodsReceiptDto) => {
    if (!window.confirm(`Eintrag „${r.goods}“ von ${r.supplier} löschen?`)) return;
    try { await api('POST', `/goods-receipts/${r.id}/remove`); toast('Eintrag gelöscht'); setRev((x) => x + 1); } catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
  };
  return (
    <section className="card hygiene goods">
      <div className="cardhead"><h2>Wareneingangskontrolle</h2><p className="muted">Bei jeder Lieferung kurz festhalten: von wem, was, Temperatur bei Kühl- und Tiefkühlware, in Ordnung oder beanstandet.</p></div>
      <form className="formgrid cols3 noprint" onSubmit={send} noValidate>
        <Field label="Lieferant" error={f.errors.supplier}><input list="goods-suppliers" value={v.supplier} onChange={(e) => setV({ ...v, supplier: e.target.value })} /></Field>
        <Field label="Ware" error={f.errors.goods} hint="z. B. Frischfleisch, Molkereiprodukte, TK-Fisch"><input value={v.goods} onChange={(e) => setV({ ...v, goods: e.target.value })} /></Field>
        <Field label="Temperatur in °C" error={f.errors.tempC} hint="nur bei Kühl-/Tiefkühlware"><input inputMode="decimal" value={v.temp} onChange={(e) => setV({ ...v, temp: e.target.value })} /></Field>
        <Field label="Befund">
          <div className="segmented" role="group" aria-label="Befund">
            <button type="button" className={v.ok ? 'on' : ''} aria-pressed={v.ok} onClick={() => setV({ ...v, ok: true })}>In Ordnung</button>
            <button type="button" className={v.ok ? '' : 'on'} aria-pressed={!v.ok} onClick={() => setV({ ...v, ok: false })}>Beanstandet</button>
          </div>
        </Field>
        <Field label={v.ok ? 'Bemerkung' : 'Was war nicht in Ordnung, was geschah mit der Ware?'} error={f.errors.note} wide><input value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></Field>
        <div className="formactions wide"><Button type="submit" variant="primary" busy={f.busy}>Eintragen</Button></div>
        <datalist id="goods-suppliers">{suppliers.map((s) => <option key={s} value={s} />)}</datalist>
      </form>
      <div className="cardhead">
        <h3>Wareneingänge {month.slice(5)}/{month.slice(0, 4)}</h3>
        <div className="actions noprint"><input type="month" value={month} max={today.slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Monat" /><Button onClick={() => printOnly('goods')}>Drucken</Button></div>
      </div>
      <LoadState error={error} loading={!data} />
      {data && (data.length === 0 ? <p className="muted">In diesem Monat ist kein Wareneingang eingetragen.</p> : (
        <div className="tablewrap"><table className="temps">
          <thead><tr><th>Datum</th><th>Lieferant</th><th>Ware</th><th className="num">Temperatur</th><th>Befund</th><th>Bemerkung</th><th>Eingetragen von</th><th className="noprint" /></tr></thead>
          <tbody>{data.map((r) => (
            <tr key={r.id}>
              <td className="nowrap">{deDate(r.date)}</td><td>{r.supplier}</td><td>{r.goods}</td><td className="num nowrap">{fmtTemp(r.tempC)}</td>
              <td>{r.ok ? <Badge tone="ok">in Ordnung</Badge> : <Badge tone="danger">beanstandet</Badge>}</td><td>{r.note}</td><td>{r.userName}</td>
              <td className="noprint">{r.date === today && <button type="button" className="linkbtn" onClick={() => void remove(r)}>löschen</button>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      ))}
    </section>
  );
}
