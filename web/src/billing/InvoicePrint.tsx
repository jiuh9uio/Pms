import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { formatMoney } from '../../../src/shared/hotel.js';
import type { InvoiceDto } from '../../../src/shared/billing.js';
import type { HotelSettings } from '../../../src/shared/schemas.js';
import { api } from '../api.ts';
import { deDate } from '../hotel/common.tsx';
import { Button, LoadState, useLoad } from '../ui.tsx';

/** Druckansicht der Rechnung – im Browser „Drucken“ → „Als PDF speichern“ erzeugt die PDF-Datei. */
export function InvoicePrint() {
  const { id } = useParams();
  const { data, error } = useLoad(async () => {
    const [inv, hotel] = await Promise.all([api<InvoiceDto>('GET', `/invoices/${id}`), api<HotelSettings>('GET', '/settings/hotel')]);
    return { inv, hotel };
  }, [id]);
  useEffect(() => {
    if (data) document.title = data.inv.number ? `${data.inv.kind === 'cancellation' ? 'Stornobeleg' : 'Rechnung'} ${data.inv.number}` : 'Rechnungsentwurf';
  }, [data]);
  if (!data) return <div className="center"><LoadState error={error} loading /></div>;
  const { inv } = data;
  // Ausgestellte Rechnungen zeigen die beim Ausstellen gespeicherten Absenderangaben, Entwürfe die aktuellen
  const h = inv.issuer ?? { ...data.hotel, footer: data.hotel.invoiceFooter };
  const draft = inv.status === 'draft';
  const cancel = inv.kind === 'cancellation';
  return (
    <div className="printpage">
      <div className="printbar noprint">
        <Button variant="primary" onClick={() => window.print()}>Drucken / als PDF speichern</Button>
        <span className="muted">{draft ? 'Entwurf – noch keine gültige Rechnung.' : 'Im Druckdialog „Als PDF speichern“ wählen, um eine PDF-Datei zu erhalten.'}</span>
      </div>
      <article className={`invoice${draft ? ' draft' : ''}`}>
        {draft && <div className="watermark" aria-hidden>ENTWURF</div>}
        <header>
          <div><h1>{h.name}</h1><p>{[h.street, [h.zip, h.city].filter(Boolean).join(' ')].filter(Boolean).join(' · ')}</p></div>
          <p className="right small">{[h.phone && `Tel. ${h.phone}`, h.email, h.website].filter(Boolean).map((x) => <span key={x}>{x}<br /></span>)}</p>
        </header>
        <section className="meta">
          <address>
            <small className="sender">{[h.name, h.street, [h.zip, h.city].filter(Boolean).join(' ')].filter(Boolean).join(' · ')}</small>
            {inv.recipientCompany && <>{inv.recipientCompany}<br /></>}
            {inv.recipientName && <>{inv.recipientName}<br /></>}
            {inv.recipientStreet && <>{inv.recipientStreet}<br /></>}
            {[inv.recipientZip, inv.recipientCity].filter(Boolean).join(' ')}
            {inv.recipientCountry && inv.recipientCountry !== 'Deutschland' && <><br />{inv.recipientCountry}</>}
            {inv.recipientVatId && <><br /><small>USt-IdNr.: {inv.recipientVatId}</small></>}
          </address>
          <table><tbody>
            <tr><td>{cancel ? 'Stornobeleg-Nr.' : 'Rechnungsnummer'}</td><td>{inv.number ?? '–'}</td></tr>
            <tr><td>Rechnungsdatum</td><td>{deDate(inv.issueDate)}</td></tr>
            <tr><td>Leistungszeitraum</td><td>{deDate(inv.serviceFrom)}{inv.serviceTo && inv.serviceTo !== inv.serviceFrom && ` – ${deDate(inv.serviceTo)}`}</td></tr>
            {inv.bookingNumber && <tr><td>Buchungsnummer</td><td>{inv.bookingNumber}</td></tr>}
            {cancel && inv.cancelsNumber && <tr><td>Storno zu</td><td>{inv.cancelsNumber}</td></tr>}
          </tbody></table>
        </section>
        <h2>{cancel ? 'Stornobeleg' : 'Rechnung'}</h2>
        <table className="pos">
          <thead><tr><th>Pos.</th><th>Leistung</th><th className="num">Menge</th><th className="num">Einzelpreis</th><th className="num">USt</th><th className="num">Betrag</th></tr></thead>
          <tbody>{inv.lines.map((l) => (
            <tr key={l.id}><td>{l.pos}</td><td>{l.description}{l.detail && <><br /><small>{l.detail}</small></>}</td><td className="num">{l.quantity.toLocaleString('de-DE')}</td>
              <td className="num">{formatMoney(l.unitPriceCents)}</td><td className="num">{l.taxRatePercent.toLocaleString('de-DE')} %</td><td className="num">{formatMoney(l.totalCents)}</td></tr>
          ))}</tbody>
          <tfoot>
            {inv.taxes.map((t) => (
              <tr key={t.rate} className="light"><td colSpan={5}>Nettobetrag {t.rate.toLocaleString('de-DE')} %: {formatMoney(t.netCents)} · enthaltene Umsatzsteuer {t.rate.toLocaleString('de-DE')} %</td><td className="num">{formatMoney(t.taxCents)}</td></tr>
            ))}
            <tr className="total"><td colSpan={5}>Gesamtbetrag (brutto)</td><td className="num">{formatMoney(inv.grossCents)}</td></tr>
            {!cancel && inv.paidCents !== 0 && <>
              <tr className="light"><td colSpan={5}>Bereits bezahlt</td><td className="num">{formatMoney(-inv.paidCents)}</td></tr>
              <tr className="total"><td colSpan={5}>{inv.openCents > 0 ? 'Zu zahlen' : inv.openCents < 0 ? 'Guthaben' : 'Offener Betrag'}</td><td className="num">{formatMoney(Math.abs(inv.openCents))}</td></tr>
            </>}
          </tfoot>
        </table>
        {inv.notes && <p className="notes">{inv.notes}</p>}
        {!cancel && inv.openCents > 0 && inv.dueDate && <p>Bitte überweisen Sie den Betrag bis zum {deDate(inv.dueDate)} unter Angabe der Rechnungsnummer.</p>}
        {!cancel && inv.openCents === 0 && inv.paidCents !== 0 && <p>Der Rechnungsbetrag wurde vollständig bezahlt. Vielen Dank!</p>}
        <footer>
          {h.footer && <p>{h.footer}</p>}
          <p>{[h.taxNumber && `Steuernummer: ${h.taxNumber}`, h.vatId && `USt-IdNr.: ${h.vatId}`].filter(Boolean).join(' · ')}</p>
          <p>{[h.bankName, h.iban && `IBAN ${h.iban}`, h.bic && `BIC ${h.bic}`].filter(Boolean).join(' · ')}</p>
        </footer>
      </article>
    </div>
  );
}
