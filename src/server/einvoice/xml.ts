import { computeEInvoice, type EInvoiceData } from '../../shared/einvoice.js';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const amount = (cents: number) => (cents / 100).toFixed(2);
const date = (iso: string) => `<udt:DateTimeString format="102">${iso.replace(/-/g, '')}</udt:DateTimeString>`;
const opt = (tag: string, value: string | undefined | null) => (value ? `<${tag}>${esc(value)}</${tag}>` : '');
/** Steuerkategorie nach UNCL 5305: S = Regelbesteuerung, E = steuerbefreit */
const category = (rate: number) => (rate > 0 ? 'S' : 'E');
const EXEMPT_REASON = 'Steuerfreie Leistung';

function party(tag: string, p: EInvoiceData['seller'] | EInvoiceData['buyer'], extra = '') {
  const s = p as Partial<EInvoiceData['seller']>;
  const contact = s.contactName || s.phone
    ? `<ram:DefinedTradeContact>${opt('ram:PersonName', s.contactName)}${s.phone ? `<ram:TelephoneUniversalCommunication><ram:CompleteNumber>${esc(s.phone)}</ram:CompleteNumber></ram:TelephoneUniversalCommunication>` : ''}${p.email ? `<ram:EmailURIUniversalCommunication><ram:URIID>${esc(p.email)}</ram:URIID></ram:EmailURIUniversalCommunication>` : ''}</ram:DefinedTradeContact>`
    : '';
  return `<${tag}>
        <ram:Name>${esc(p.name)}</ram:Name>${contact}
        <ram:PostalTradeAddress>${opt('ram:PostcodeCode', p.zip)}${opt('ram:LineOne', p.street)}${opt('ram:CityName', p.city)}<ram:CountryID>${p.country}</ram:CountryID></ram:PostalTradeAddress>
        ${p.email ? `<ram:URIUniversalCommunication><ram:URIID schemeID="EM">${esc(p.email)}</ram:URIID></ram:URIUniversalCommunication>` : ''}
        ${p.vatId ? `<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${esc(p.vatId.replace(/\s/g, ''))}</ram:ID></ram:SpecifiedTaxRegistration>` : ''}
        ${s.taxNumber ? `<ram:SpecifiedTaxRegistration><ram:ID schemeID="FC">${esc(s.taxNumber)}</ram:ID></ram:SpecifiedTaxRegistration>` : ''}${extra}
      </${tag}>`;
}

/**
 * Erzeugt die XML-Datei der E-Rechnung (UN/CEFACT Cross Industry Invoice, Profil EN 16931).
 * Die Reihenfolge der Elemente ist durch das Schema vorgegeben.
 */
export function buildXml(d: EInvoiceData): string {
  const c = computeEInvoice(d);
  const lines = c.lines.map((l) => `
    <ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument><ram:LineID>${l.id}</ram:LineID></ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedTradeProduct><ram:Name>${esc(l.name)}</ram:Name></ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice><ram:ChargeAmount>${l.netUnit.toFixed(4)}</ram:ChargeAmount></ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement>
      <ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="C62">${l.quantity}</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement>
        <ram:ApplicableTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>${category(l.taxRate)}</ram:CategoryCode><ram:RateApplicablePercent>${l.taxRate}</ram:RateApplicablePercent></ram:ApplicableTradeTax>
        <ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>${amount(l.netCents)}</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation>
      </ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>`).join('');
  const taxes = c.taxes.map((t) => `
      <ram:ApplicableTradeTax>
        <ram:CalculatedAmount>${amount(t.taxCents)}</ram:CalculatedAmount><ram:TypeCode>VAT</ram:TypeCode>${t.rate > 0 ? '' : `<ram:ExemptionReason>${EXEMPT_REASON}</ram:ExemptionReason>`}
        <ram:BasisAmount>${amount(t.basisCents)}</ram:BasisAmount><ram:CategoryCode>${category(t.rate)}</ram:CategoryCode><ram:RateApplicablePercent>${t.rate}</ram:RateApplicablePercent>
      </ram:ApplicableTradeTax>`).join('');
  const means = d.paymentMeans === '58' && !d.iban ? '1' : d.paymentMeans;
  const terms = d.paymentTerms || d.dueDate
    ? `<ram:SpecifiedTradePaymentTerms>${opt('ram:Description', d.paymentTerms)}${d.dueDate ? `<ram:DueDateDateTime>${date(d.dueDate)}</ram:DueDateDateTime>` : ''}</ram:SpecifiedTradePaymentTerms>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100" xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100">
  <rsm:ExchangedDocumentContext>
    <ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>urn:cen.eu:en16931:2017</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
    <ram:ID>${esc(d.number)}</ram:ID>
    <ram:TypeCode>380</ram:TypeCode>
    <ram:IssueDateTime>${date(d.issueDate)}</ram:IssueDateTime>${d.note ? `
    <ram:IncludedNote><ram:Content>${esc(d.note)}</ram:Content></ram:IncludedNote>` : ''}
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>${lines}
    <ram:ApplicableHeaderTradeAgreement>${opt('ram:BuyerReference', d.buyer.reference)}
      ${party('ram:SellerTradeParty', d.seller)}
      ${party('ram:BuyerTradeParty', d.buyer)}
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeDelivery>
      <ram:ActualDeliverySupplyChainEvent><ram:OccurrenceDateTime>${date(d.serviceTo)}</ram:OccurrenceDateTime></ram:ActualDeliverySupplyChainEvent>
    </ram:ApplicableHeaderTradeDelivery>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
      <ram:SpecifiedTradeSettlementPaymentMeans><ram:TypeCode>${means}</ram:TypeCode>${means === '58' ? `<ram:PayeePartyCreditorFinancialAccount><ram:IBANID>${esc(d.iban.replace(/\s/g, ''))}</ram:IBANID></ram:PayeePartyCreditorFinancialAccount>${d.bic ? `<ram:PayeeSpecifiedCreditorFinancialInstitution><ram:BICID>${esc(d.bic.replace(/\s/g, ''))}</ram:BICID></ram:PayeeSpecifiedCreditorFinancialInstitution>` : ''}` : ''}</ram:SpecifiedTradeSettlementPaymentMeans>${taxes}
      <ram:BillingSpecifiedPeriod><ram:StartDateTime>${date(d.serviceFrom)}</ram:StartDateTime><ram:EndDateTime>${date(d.serviceTo)}</ram:EndDateTime></ram:BillingSpecifiedPeriod>
      ${terms}
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>${amount(c.lineTotalCents)}</ram:LineTotalAmount>
        <ram:TaxBasisTotalAmount>${amount(c.lineTotalCents)}</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="EUR">${amount(c.taxTotalCents)}</ram:TaxTotalAmount>${c.roundingCents ? `
        <ram:RoundingAmount>${amount(c.roundingCents)}</ram:RoundingAmount>` : ''}
        <ram:GrandTotalAmount>${amount(c.grandTotalCents)}</ram:GrandTotalAmount>
        <ram:TotalPrepaidAmount>${amount(d.paidCents)}</ram:TotalPrepaidAmount>
        <ram:DuePayableAmount>${amount(c.dueCents)}</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>
`;
}
