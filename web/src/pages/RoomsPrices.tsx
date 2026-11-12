import { useState, type ReactNode } from 'react';
import type { ZodType } from 'zod';
import type { TaxRateDto } from '../../../src/shared/schemas.js';
import {
  MODE_LABEL, PER_LABEL, RULE_MODES, SERVICE_PER, categoryInput, roomBulkInput, formatMoney, moneyInput, parseMoney, rateRuleInput, roomInput, serviceInput, todayBerlin,
  type CategoryDto, type RateRuleDto, type RoomDto, type ServiceDto,
} from '../../../src/shared/hotel.js';
import { api } from '../api.ts';
import { useData } from '../data.tsx';
import { WD, deDate } from '../hotel/common.tsx';
import { Badge, Button, Dialog, Field, LoadState, PageHeader, useLoad, useSubmit, useToast } from '../ui.tsx';

type Value = string | boolean | number[];
type Draft = Record<string, Value>;
interface FieldDef {
  key: string; label: string; hint?: string; wide?: boolean;
  type: 'text' | 'money' | 'moneyOpt' | 'int' | 'number' | 'select' | 'selectOpt' | 'check' | 'date' | 'weekdays';
  options?: [string, string][];
}

/** Entwurf (Texte aus den Eingabefeldern) in die Werte umwandeln, die der Server erwartet. */
function toPayload(fields: FieldDef[], d: Draft) {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = d[f.key];
    const s = typeof v === 'string' ? v.trim() : '';
    if (f.type === 'money') out[f.key] = parseMoney(s);
    else if (f.type === 'moneyOpt') out[f.key] = s === '' ? null : parseMoney(s);
    else if (f.type === 'int' || f.type === 'number') out[f.key] = s === '' ? NaN : Number(s.replace(',', '.'));
    else if (f.type === 'selectOpt') out[f.key] = s === '' ? null : s;
    else out[f.key] = v;
  }
  return out;
}

function MasterDialog({ title, fields, initial, schema, path, id, version, onClose }: {
  title: string; fields: FieldDef[]; initial: Draft; schema: ZodType; path: string; id: string | null; version?: number; onClose: () => void;
}) {
  const { bump } = useData();
  const toast = useToast();
  const [d, setD] = useState<Draft>(initial);
  const f = useSubmit(schema, async (v) => {
    await api(id ? 'PUT' : 'POST', id ? `${path}/${id}` : path, id ? { ...(v as object), version } : v);
    toast('Gespeichert');
    bump();
    onClose();
  });
  const send = (e?: React.FormEvent) => void f.submit(toPayload(fields, d), e);
  const set = (k: string, v: Value) => setD({ ...d, [k]: v });
  return (
    <Dialog title={title} onClose={onClose}
      footer={<><Button onClick={onClose}>Abbrechen</Button><Button variant="primary" busy={f.busy} onClick={() => send()}>Speichern</Button></>}>
      <form className="formgrid" onSubmit={send} noValidate>
        {fields.map((fd) => {
          const v = d[fd.key];
          if (fd.type === 'check')
            return <label key={fd.key} className="check wide"><input type="checkbox" checked={v as boolean} onChange={(e) => set(fd.key, e.target.checked)} /><span>{fd.label}{fd.hint && <small>{fd.hint}</small>}</span></label>;
          if (fd.type === 'weekdays') {
            const days = v as number[];
            return (
              <Field key={fd.key} label={fd.label} hint={fd.hint} wide error={f.errors[fd.key]}>
                <div className="weekdays">
                  {[1, 2, 3, 4, 5, 6, 0].map((n) => (
                    <button key={n} type="button" className={days.includes(n) ? 'on' : ''} aria-pressed={days.includes(n)}
                      onClick={() => set(fd.key, days.includes(n) ? days.filter((x) => x !== n) : [...days, n])}>{WD[n]}</button>
                  ))}
                </div>
              </Field>
            );
          }
          return (
            <Field key={fd.key} label={fd.label} hint={fd.hint} wide={fd.wide} error={f.errors[fd.key]}>
              {fd.type === 'select' || fd.type === 'selectOpt'
                ? <select value={v as string} onChange={(e) => set(fd.key, e.target.value)}>{fd.options!.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                : <input type={fd.type === 'date' ? 'date' : 'text'} inputMode={fd.type === 'text' || fd.type === 'date' ? undefined : 'decimal'} value={v as string} onChange={(e) => set(fd.key, e.target.value)} />}
            </Field>
          );
        })}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

function Section({ title, hint, add, extra, children }: { title: string; hint?: string; add: () => void; extra?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      <div className="cardhead"><div><h2>{title}</h2>{hint && <p className="muted">{hint}</p>}</div><div className="actions">{extra}<Button onClick={add}>Anlegen</Button></div></div>
      {children}
    </section>
  );
}
const Active = ({ on }: { on: boolean }) => (on ? <Badge tone="ok">Aktiv</Badge> : <Badge>Inaktiv</Badge>);
const rowProps = (open: () => void) => ({ className: 'rowlink', tabIndex: 0, onClick: open, onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter') open(); } });

export function RoomsPrices() {
  const { rev } = useData();
  const { data, error } = useLoad(async () => {
    const [cats, rooms, rules, services, taxes] = await Promise.all([
      api<CategoryDto[]>('GET', '/categories'), api<RoomDto[]>('GET', '/rooms'), api<RateRuleDto[]>('GET', '/rate-rules'),
      api<ServiceDto[]>('GET', '/services'), api<TaxRateDto[]>('GET', '/tax-rates'),
    ]);
    return { cats, rooms, rules, services, taxes: taxes.filter((t) => t.active) };
  }, [rev]);
  const [dlg, setDlg] = useState<ReactNode>(null);
  const close = () => setDlg(null);
  if (!data) return <><PageHeader title="Zimmer & Preise" /><LoadState error={error} loading /></>;
  const { cats, rooms, rules, services, taxes } = data;
  const catOpts = cats.map((c): [string, string] => [c.id, c.name]);

  const editCat = (c?: CategoryDto) => setDlg(<MasterDialog title={c ? 'Kategorie bearbeiten' : 'Kategorie anlegen'} path="/categories" id={c?.id ?? null} version={c?.version} schema={categoryInput} onClose={close}
    fields={[
      { key: 'name', label: 'Name', type: 'text' }, { key: 'basePriceCents', label: 'Grundpreis je Nacht (brutto)', type: 'money' },
      { key: 'description', label: 'Beschreibung', type: 'text', wide: true },
      { key: 'stdOccupancy', label: 'Standardbelegung', type: 'int' }, { key: 'maxPersons', label: 'Höchstbelegung', type: 'int' },
      { key: 'sort', label: 'Reihenfolge', type: 'int', hint: 'kleine Zahl zuerst' },
    ]}
    initial={{ name: c?.name ?? '', basePriceCents: moneyInput(c?.basePriceCents), description: c?.description ?? '', stdOccupancy: String(c?.stdOccupancy ?? 2), maxPersons: String(c?.maxPersons ?? 2), sort: String(c?.sort ?? cats.length + 1) }} />);

  const editRoom = (r?: RoomDto) => setDlg(<MasterDialog title={r ? `Zimmer ${r.number} bearbeiten` : 'Zimmer anlegen'} path="/rooms" id={r?.id ?? null} version={r?.version} schema={roomInput} onClose={close}
    fields={[
      { key: 'number', label: 'Zimmernummer', type: 'text' }, { key: 'categoryId', label: 'Kategorie', type: 'select', options: [['', 'Bitte wählen'], ...catOpts] },
      { key: 'floor', label: 'Etage', type: 'text' }, { key: 'priceOverrideCents', label: 'Eigener Preis je Nacht', type: 'moneyOpt', hint: 'leer = Preis der Kategorie' },
      { key: 'note', label: 'Notiz', type: 'text', wide: true },
      { key: 'active', label: 'Buchbar', type: 'check', hint: 'Nicht buchbare Zimmer erscheinen nicht im Belegungsplan.' },
    ]}
    initial={{ number: r?.number ?? '', categoryId: r?.categoryId ?? cats[0]?.id ?? '', floor: r?.floor ?? '', priceOverrideCents: moneyInput(r?.priceOverrideCents), note: r?.note ?? '', active: r?.active ?? true }} />);

  // nächste freie Nummer als Vorschlag: höchste vorhandene Zahl + 1
  const nextNumber = Math.max(0, ...rooms.map((r) => Number(r.number)).filter((n) => Number.isInteger(n))) + 1;
  const addMany = () => setDlg(<MasterDialog title="Mehrere Zimmer anlegen" path="/rooms/bulk" id={null} schema={roomBulkInput} onClose={close}
    fields={[
      { key: 'categoryId', label: 'Kategorie', type: 'select', options: [['', 'Bitte wählen'], ...catOpts], wide: true },
      { key: 'count', label: 'Anzahl Zimmer', type: 'int' }, { key: 'firstNumber', label: 'Erste Zimmernummer', type: 'int', hint: 'Die weiteren Zimmer werden fortlaufend nummeriert.' },
      { key: 'floor', label: 'Etage', type: 'text', hint: 'optional' },
    ]}
    initial={{ categoryId: cats[0]?.id ?? '', count: '5', firstNumber: String(nextNumber), floor: '' }} />);

  const editRule = (r?: RateRuleDto) => setDlg(<MasterDialog title={r ? 'Preisregel bearbeiten' : 'Preisregel anlegen'} path="/rate-rules" id={r?.id ?? null} version={r?.version} schema={rateRuleInput} onClose={close}
    fields={[
      { key: 'name', label: 'Name', type: 'text', wide: true },
      { key: 'startDate', label: 'Gültig von', type: 'date' }, { key: 'endDate', label: 'Gültig bis (einschließlich)', type: 'date' },
      { key: 'weekdays', label: 'Wochentage', type: 'weekdays', hint: 'Nichts gewählt = alle Tage. Für Wochenendpreise Fr und Sa wählen (Nacht von Freitag auf Samstag zählt als Freitag).' },
      { key: 'categoryId', label: 'Kategorie', type: 'selectOpt', options: [['', 'Alle Kategorien'], ...catOpts] },
      { key: 'mode', label: 'Art', type: 'select', options: RULE_MODES.map((m) => [m, MODE_LABEL[m]]) },
      { key: 'value', label: 'Wert', type: 'number', hint: 'z. B. 10 für +10 %, −15 für 15 € Nachlass' }, { key: 'priority', label: 'Priorität', type: 'int', hint: 'kleine Zahl wird zuerst angewendet' },
      { key: 'active', label: 'Aktiv', type: 'check' },
    ]}
    initial={{ name: r?.name ?? '', startDate: r?.startDate ?? todayBerlin(), endDate: r?.endDate ?? `${Number(todayBerlin().slice(0, 4)) + 1}-12-31`, weekdays: r?.weekdays ?? [], categoryId: r?.categoryId ?? '', mode: r?.mode ?? 'percent', value: r ? String(r.value).replace('.', ',') : '', priority: String(r?.priority ?? 10), active: r?.active ?? true }} />);

  const editService = (s?: ServiceDto) => setDlg(<MasterDialog title={s ? 'Leistung bearbeiten' : 'Leistung anlegen'} path="/services" id={s?.id ?? null} version={s?.version} schema={serviceInput} onClose={close}
    fields={[
      { key: 'name', label: 'Name', type: 'text' }, { key: 'priceCents', label: 'Preis (brutto)', type: 'money' },
      { key: 'per', label: 'Berechnung', type: 'select', options: SERVICE_PER.map((p) => [p, PER_LABEL[p]]) },
      { key: 'taxRateId', label: 'Steuersatz', type: 'select', options: [['', 'Bitte wählen'], ...taxes.map((t): [string, string] => [t.id, `${t.ratePercent.toLocaleString('de-DE')} % – ${t.name}`])] },
      { key: 'isBreakfast', label: 'Ist das Frühstück', type: 'check', hint: 'Wird bei „Mit Frühstück“ in neuen Reservierungen automatisch gebucht.' },
      { key: 'active', label: 'Aktiv', type: 'check' },
    ]}
    initial={{ name: s?.name ?? '', priceCents: moneyInput(s?.priceCents), per: s?.per ?? 'stay', taxRateId: s?.taxRateId ?? taxes.find((t) => t.defaultFor === 'services')?.id ?? '', isBreakfast: s?.isBreakfast ?? false, active: s?.active ?? true }} />);

  const ruleValue = (r: RateRuleDto) => (r.mode === 'percent' ? `${r.value > 0 ? '+' : ''}${r.value.toLocaleString('de-DE')} %` : r.mode === 'amount' ? `${r.value > 0 ? '+' : ''}${formatMoney(r.value * 100)}` : formatMoney(r.value * 100));

  return (
    <>
      <PageHeader title="Zimmer & Preise" sub="Kategorien, Zimmer, Preisregeln und Zusatzleistungen. Alle Preise sind Bruttopreise." />
      {rooms.length === 0 && (
        <p className="notice">So richten Sie das Haus ein: <b>1.</b> Kategorien anlegen (Art des Zimmers und Preis je Nacht), <b>2.</b> unter „Zimmer“ mit „Mehrere anlegen“ die Anzahl je Kategorie eintragen, <b>3.</b> bei Bedarf Preisregeln und Frühstück ergänzen. Alles lässt sich später ändern.</p>
      )}
      <Section title="Kategorien" add={() => editCat()}>
        {cats.length === 0 ? <p className="muted">Zuerst eine Kategorie anlegen (z. B. Einzelzimmer, Doppelzimmer), danach die Zimmer.</p> : (
          <div className="tablewrap"><table>
            <thead><tr><th>Kategorie</th><th className="num">Grundpreis</th><th className="num">Belegung</th><th className="num">Zimmer</th></tr></thead>
            <tbody>{cats.map((c) => (
              <tr key={c.id} {...rowProps(() => editCat(c))}><td><b>{c.name}</b>{c.description && <><br /><small>{c.description}</small></>}</td>
                <td className="num">{formatMoney(c.basePriceCents)}</td><td className="num">{c.stdOccupancy} (max. {c.maxPersons})</td><td className="num">{rooms.filter((r) => r.categoryId === c.id).length}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </Section>
      <Section title="Zimmer" hint={`${rooms.filter((r) => r.active).length} buchbare Zimmer`} add={() => (cats.length ? editRoom() : editCat())}
        extra={cats.length > 0 && <Button onClick={addMany}>Mehrere anlegen</Button>}>
        {rooms.length === 0 ? <p className="muted">Noch keine Zimmer angelegt.</p> : (
          <div className="tablewrap"><table>
            <thead><tr><th>Nr.</th><th>Kategorie</th><th className="hide-sm">Etage</th><th className="num">Preis je Nacht</th><th>Status</th></tr></thead>
            <tbody>{rooms.map((r) => (
              <tr key={r.id} {...rowProps(() => editRoom(r))}><td><b>{r.number}</b>{r.note && <><br /><small>{r.note}</small></>}</td><td>{r.categoryName}</td><td className="hide-sm">{r.floor}</td>
                <td className="num">{formatMoney(r.priceCents)}{r.priceOverrideCents != null && <><br /><small>eigener Preis</small></>}</td><td><Active on={r.active} /></td></tr>
            ))}</tbody>
          </table></div>
        )}
      </Section>
      <Section title="Preisregeln" hint="Saison-, Wochenend- und Aktionspreise. Regeln wirken nur auf neue Buchungen; gebuchte Preise bleiben bestehen." add={() => editRule()}>
        {rules.length === 0 ? <p className="muted">Keine Regeln – es gilt immer der Grundpreis.</p> : (
          <div className="tablewrap"><table>
            <thead><tr><th>Name</th><th>Zeitraum</th><th className="hide-sm">Tage</th><th className="hide-sm">Kategorie</th><th className="num">Wert</th><th className="num hide-sm">Priorität</th><th>Status</th></tr></thead>
            <tbody>{rules.map((r) => (
              <tr key={r.id} {...rowProps(() => editRule(r))}><td><b>{r.name}</b></td><td className="nowrap">{deDate(r.startDate)} – {deDate(r.endDate)}</td>
                <td className="hide-sm">{r.weekdays.length ? [1, 2, 3, 4, 5, 6, 0].filter((n) => r.weekdays.includes(n)).map((n) => WD[n]).join(', ') : 'alle'}</td>
                <td className="hide-sm">{cats.find((c) => c.id === r.categoryId)?.name ?? 'alle'}</td><td className="num">{ruleValue(r)}</td><td className="num hide-sm">{r.priority}</td><td><Active on={r.active} /></td></tr>
            ))}</tbody>
          </table></div>
        )}
      </Section>
      <Section title="Frühstück und Zusatzleistungen" add={() => editService()}>
        {services.length === 0 ? <p className="muted">Noch keine Leistungen angelegt (z. B. Frühstück, Parkplatz, Haustier).</p> : (
          <div className="tablewrap"><table>
            <thead><tr><th>Leistung</th><th className="num">Preis</th><th>Berechnung</th><th className="num">MwSt.</th><th>Status</th></tr></thead>
            <tbody>{services.map((s) => (
              <tr key={s.id} {...rowProps(() => editService(s))}><td><b>{s.name}</b>{s.isBreakfast && <> <Badge tone="accent">Frühstück</Badge></>}</td><td className="num">{formatMoney(s.priceCents)}</td>
                <td>{PER_LABEL[s.per]}</td><td className="num">{s.taxRatePercent.toLocaleString('de-DE')} %</td><td><Active on={s.active} /></td></tr>
            ))}</tbody>
          </table></div>
        )}
      </Section>
      {dlg}
    </>
  );
}
