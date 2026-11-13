import { useEffect, useState } from 'react';
import { hotelSettings, taxRateCreateInput, taxRateUpdateInput, type HotelSettings, type TaxRateDto } from '../../../src/shared/schemas.js';
import { api } from '../api.ts';
import { MailSettings } from './MailSettings.tsx';
import { BackupCard } from './BackupCard.tsx';
import { UpdateCard } from './UpdateCard.tsx';
import { Badge, Button, Dialog, Field, LoadState, PageHeader, useLoad, useSubmit, useToast } from '../ui.tsx';

export function Settings() {
  return (
    <>
      <PageHeader title="Einstellungen" sub="Stammdaten des Hauses, Steuersätze, Datensicherung und Programm-Update" />
      <HotelForm />
      <MailSettings />
      <TaxRates />
      <NetworkCard />
      <BackupCard />
      <UpdateCard />
    </>
  );
}

function HotelForm() {
  const toast = useToast();
  const { data, error } = useLoad(() => api<HotelSettings>('GET', '/settings/hotel'));
  const [v, setV] = useState<HotelSettings | null>(null);
  useEffect(() => { if (data) setV(data); }, [data]);
  const f = useSubmit(hotelSettings, async (d) => {
    setV(await api<HotelSettings>('PUT', '/settings/hotel', d));
    toast('Stammdaten gespeichert');
  });
  if (!v) return <LoadState error={error} loading />;
  const input = (k: keyof HotelSettings, label: string, o: { type?: string; wide?: boolean; hint?: string } = {}) => (
    <Field label={label} error={f.errors[k]} wide={o.wide} hint={o.hint}>
      <input type={o.type ?? 'text'} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
    </Field>
  );
  return (
    <form className="card" onSubmit={(e) => void f.submit(v, e)} noValidate>
      <h2>Hotel</h2>
      <div className="formgrid cols3">
        {input('name', 'Name des Hauses', { wide: true })}
        {input('street', 'Straße und Hausnummer')}{input('zip', 'PLZ')}{input('city', 'Ort')}
        {input('country', 'Land')}{input('phone', 'Telefon')}{input('email', 'E-Mail', { type: 'email' })}
        {input('website', 'Website')}{input('checkinTime', 'Check-in ab', { type: 'time' })}{input('checkoutTime', 'Check-out bis', { type: 'time' })}
      </div>
      <h3>Angaben für Rechnungen</h3>
      <div className="formgrid cols3">
        {input('taxNumber', 'Steuernummer')}{input('vatId', 'USt-IdNr.', { hint: 'falls vorhanden' })}{input('bankName', 'Bank')}
        {input('iban', 'IBAN')}{input('bic', 'BIC')}
        {input('invoicePrefix', 'Kürzel vor der Rechnungsnummer', { hint: `ergibt z. B. ${v.invoicePrefix ? v.invoicePrefix + '-' : ''}${new Date().getFullYear()}-0001` })}
        <Field label="Zahlungsziel in Tagen" error={f.errors.paymentTermDays}><input inputMode="numeric" value={String(v.paymentTermDays)} onChange={(e) => setV({ ...v, paymentTermDays: e.target.value === '' ? ('' as never) : Number(e.target.value) })} /></Field>
        <Field label="Fußtext auf Rechnungen" wide error={f.errors.invoiceFooter} hint="z. B. Geschäftsführung, Handelsregister, Grußformel"><textarea rows={2} value={v.invoiceFooter} onChange={(e) => setV({ ...v, invoiceFooter: e.target.value })} /></Field>
      </div>
      <p className="muted small">Zum Ausstellen von Rechnungen sind Anschrift sowie Steuernummer oder USt-IdNr. Pflicht. Die Angaben werden in jede Rechnung kopiert; spätere Änderungen wirken nur auf neue Rechnungen.</p>
      <div className="formactions"><Button type="submit" variant="primary" busy={f.busy}>Speichern</Button></div>
    </form>
  );
}

const USE = { lodging: 'Übernachtung', services: 'Frühstück und Zusatzleistungen' } as const;
type Draft = { name: string; rate: string; defaultFor: '' | 'lodging' | 'services'; active: boolean };
const toNumber = (s: string) => (s.trim() === '' ? NaN : Number(s.replace(',', '.')));

function TaxRates() {
  const { data, error, reload } = useLoad(() => api<TaxRateDto[]>('GET', '/tax-rates'));
  const [edit, setEdit] = useState<TaxRateDto | 'new' | null>(null);
  return (
    <section className="card">
      <div className="cardhead">
        <div><h2>Steuersätze</h2><p className="muted">Der Standardsatz wird bei neuen Preisen und Leistungen vorbelegt. Bereits ausgestellte Rechnungen behalten ihren Satz.</p></div>
        <Button onClick={() => setEdit('new')}>Steuersatz anlegen</Button>
      </div>
      <LoadState error={error} loading={!data} />
      {data && (
        <div className="tablewrap">
          <table>
            <thead><tr><th>Bezeichnung</th><th className="num">Satz</th><th>Standard für</th><th>Status</th></tr></thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.id} className="rowlink" tabIndex={0} onClick={() => setEdit(r)} onKeyDown={(e) => { if (e.key === 'Enter') setEdit(r); }}>
                  <td className="strong">{r.name}</td>
                  <td className="num">{r.ratePercent.toLocaleString('de-DE')} %</td>
                  <td>{r.defaultFor ? <Badge tone="accent">{USE[r.defaultFor]}</Badge> : <span className="muted">–</span>}</td>
                  <td>{r.active ? <Badge tone="ok">Aktiv</Badge> : <Badge>Deaktiviert</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {edit && <TaxRateDialog rate={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reload(); }} />}
    </section>
  );
}

function TaxRateDialog({ rate, onClose, onDone }: { rate: TaxRateDto | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [v, setV] = useState<Draft>({
    name: rate?.name ?? '', rate: rate ? String(rate.ratePercent).replace('.', ',') : '', defaultFor: rate?.defaultFor ?? '', active: rate?.active ?? true,
  });
  const payload = { name: v.name, ratePercent: toNumber(v.rate), defaultFor: v.defaultFor || null };
  const create = useSubmit(taxRateCreateInput, async (d) => { await api('POST', '/tax-rates', d); toast('Steuersatz angelegt'); onDone(); });
  const update = useSubmit(taxRateUpdateInput, async (d) => { await api('PATCH', `/tax-rates/${rate!.id}`, d); toast('Gespeichert'); onDone(); });
  const f = rate ? update : create;
  const send = (e?: React.FormEvent) => void (rate ? update.submit({ ...payload, active: v.active, version: rate.version }, e) : create.submit(payload, e));
  return (
    <Dialog title={rate ? 'Steuersatz bearbeiten' : 'Steuersatz anlegen'} onClose={onClose}
      footer={<><Button onClick={onClose}>Abbrechen</Button><Button variant="primary" busy={f.busy} onClick={() => send()}>Speichern</Button></>}>
      <form className="formgrid" onSubmit={send} noValidate>
        <Field label="Bezeichnung" error={f.errors.name}><input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} autoFocus /></Field>
        <Field label="Satz in %" error={f.errors.ratePercent}><input inputMode="decimal" value={v.rate} onChange={(e) => setV({ ...v, rate: e.target.value })} /></Field>
        <Field label="Standard für" wide hint="Je Verwendung gibt es genau einen Standard; ein bisheriger Standard wird abgelöst.">
          <select value={v.defaultFor} onChange={(e) => setV({ ...v, defaultFor: e.target.value as Draft['defaultFor'] })} disabled={!v.active}>
            <option value="">kein Standard</option><option value="lodging">{USE.lodging}</option><option value="services">{USE.services}</option>
          </select>
        </Field>
        {rate && (
          <label className="check wide">
            <input type="checkbox" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked, defaultFor: e.target.checked ? v.defaultFor : '' })} />
            <span>Aktiv <small>Deaktivierte Sätze stehen für neue Preise nicht mehr zur Auswahl.</small></span>
          </label>
        )}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

/** Unter welcher Adresse Tablets, weitere Rechner und Gäste-Handys (Meldeschein per QR) das Programm erreichen. */
function NetworkCard() {
  const { data, error } = useLoad(() => api<{ addresses: string[]; localOnly: boolean }>('GET', '/system/network'));
  return (
    <section className="card">
      <h2>Zugriff im Hausnetz</h2>
      {!data ? <LoadState error={error} loading /> : data.localOnly ? (
        <p className="notice warn">Das Programm ist nur an diesem Rechner erreichbar (HOST=127.0.0.1 in pms.env). Für Tablets, weitere Rechner und den Meldeschein per QR-Code dort HOST=0.0.0.0 eintragen und neu starten.</p>
      ) : data.addresses.length === 0 ? (
        <p className="notice warn">Dieser Rechner hat gerade keine Netzwerkverbindung.</p>
      ) : (
        <>
          <p>Andere Geräte im selben Netz öffnen das Programm im Browser unter:</p>
          <ul>{data.addresses.map((a) => <li key={a}><b>{a}</b></li>)}</ul>
          <p className="muted small">
            Geht die Seite auf einem anderen Gerät nicht auf, blockiert meist die Windows-Firewall: im Programmordner „Firewall freigeben.bat“ mit Rechtsklick → „Als Administrator ausführen“ starten.
            Die Adresse kann sich ändern, wenn der Router dem Rechner eine neue vergibt – am besten im Router eine feste Adresse für diesen Rechner einstellen.
            Die Verbindung im Hausnetz ist nicht verschlüsselt; das Programm nicht aus dem Internet erreichbar machen.
          </p>
        </>
      )}
    </section>
  );
}
