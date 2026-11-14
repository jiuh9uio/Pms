import { and, asc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import {
  taxBreakdown, type BookingBillingDto, type InvoiceDto, type InvoiceListRow, type IssuerDto, type PaymentDto,
} from '../../shared/billing.js';
import { addDays, isActiveStatus, todayBerlin } from '../../shared/hotel.js';
import type { Db, Exec, Tx } from '../db/client.js';
import { bookings, companies, invoiceLines, invoices, numberSequences, payments, invoiceDocuments, settings } from '../db/schema.js';
import { renderInvoice, type Logo } from '../einvoice/invoicepdf.js';
import { AppError, conflict, notFound, stale } from '../lib/errors.js';
import type { InvoiceNumberState } from '../../shared/schemas.js';
import { record, type Actor } from './audit.js';
import { getBooking } from './bookings.js';
import { getHotel } from './settings.js';

type Raw = Record<string, unknown>;
const de = (s: string) => `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}`;
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

// ---------- Lesen ----------
const LIST = sql`
  select i.*, b.number as booking_number, c.number as cancels_number, cb.id as cancelled_by_id, cb.number as cancelled_by_number,
    coalesce((select sum(p.amount_cents) from payments p where p.invoice_id = i.id), 0)::int as paid_cents
  from invoices i
    left join bookings b on b.id = i.booking_id
    left join invoices c on c.id = i.cancels_id
    left join invoices cb on cb.cancels_id = i.id`;

function toRow(x: Raw): InvoiceListRow {
  const status = x.status as InvoiceListRow['status'];
  const gross = x.gross_cents as number;
  const paid = x.paid_cents as number;
  return {
    id: x.id as string, number: (x.number as string) ?? null, kind: x.kind as InvoiceListRow['kind'], status,
    bookingId: (x.booking_id as string) ?? null, bookingNumber: (x.booking_number as string) ?? null,
    cancelsId: (x.cancels_id as string) ?? null, cancelsNumber: (x.cancels_number as string) ?? null,
    cancelledById: (x.cancelled_by_id as string) ?? null, cancelledByNumber: (x.cancelled_by_number as string) ?? null,
    recipientCompany: x.recipient_company as string, recipientName: x.recipient_name as string, recipientStreet: x.recipient_street as string,
    recipientZip: x.recipient_zip as string, recipientCity: x.recipient_city as string, recipientCountry: x.recipient_country as string,
    recipientVatId: x.recipient_vat_id as string,
    serviceFrom: x.service_from ? String(x.service_from).slice(0, 10) : null, serviceTo: x.service_to ? String(x.service_to).slice(0, 10) : null,
    issueDate: x.issue_date ? String(x.issue_date).slice(0, 10) : null, dueDate: x.due_date ? String(x.due_date).slice(0, 10) : null,
    notes: x.notes as string, cancelReason: x.cancel_reason as string,
    grossCents: gross, paidCents: paid,
    // offen ist nur eine gültige (ausgestellte) Rechnung
    openCents: status === 'issued' && x.kind === 'invoice' ? gross - paid : 0,
    createdBy: x.created_by as string, issuedBy: x.issued_by as string, issuedAt: iso(x.issued_at), version: x.version as number,
  };
}

export async function listInvoices(db: Exec, f: { status?: string; q?: string; from?: string; to?: string; bookingId?: string; serviceFrom?: string; serviceTo?: string; method?: string }) {
  const c: SQL[] = [sql`true`];
  if (f.status === 'open') c.push(sql`i.status = 'issued' and i.kind = 'invoice' and i.gross_cents <> coalesce((select sum(p.amount_cents) from payments p where p.invoice_id = i.id), 0)`);
  else if (f.status === 'paid') c.push(sql`i.status = 'issued' and i.kind = 'invoice' and i.gross_cents = coalesce((select sum(p.amount_cents) from payments p where p.invoice_id = i.id), 0)`);
  else if (f.status === 'archive') c.push(sql`i.status <> 'draft'`);
  else if (f.status) c.push(sql`i.status = ${f.status}`);
  // Leistungszeitraum überschneidet den gewählten Zeitraum
  if (f.serviceFrom) c.push(sql`coalesce(i.service_to, i.service_from) >= ${f.serviceFrom}::date`);
  if (f.serviceTo) c.push(sql`i.service_from <= ${f.serviceTo}::date`);
  if (f.method) c.push(sql`exists (select 1 from payments p where p.invoice_id = i.id and p.method = ${f.method})`);
  if (f.from) c.push(sql`coalesce(i.issue_date, i.created_at::date) >= ${f.from}::date`);
  if (f.to) c.push(sql`coalesce(i.issue_date, i.created_at::date) <= ${f.to}::date`);
  if (f.bookingId) c.push(sql`i.booking_id = ${f.bookingId}`);
  if (f.q) {
    const like = '%' + f.q.replace(/[%_\\]/g, '') + '%';
    c.push(sql`(i.number ilike ${like} or i.recipient_name ilike ${like} or i.recipient_company ilike ${like} or b.number ilike ${like})`);
  }
  const rows = await db.execute(sql`${LIST} where ${sql.join(c, sql` and `)} order by coalesce(i.issued_at, i.created_at) desc limit 500`);
  return Array.from(rows).map((r) => toRow(r as Raw));
}

async function paymentsWhere(db: Exec, where: SQL): Promise<PaymentDto[]> {
  const rows = await db.execute(sql`
    select p.*, i.number as invoice_number, exists(select 1 from payments r where r.reverses_id = p.id) as reversed
    from payments p left join invoices i on i.id = p.invoice_id where ${where} order by p.date, p.created_at`);
  return Array.from(rows).map((r) => {
    const x = r as Raw;
    return {
      id: x.id as string, bookingId: (x.booking_id as string) ?? null, invoiceId: (x.invoice_id as string) ?? null, invoiceNumber: (x.invoice_number as string) ?? null,
      amountCents: x.amount_cents as number, method: x.method as string, date: String(x.date).slice(0, 10), payer: x.payer as string, note: x.note as string,
      reversesId: (x.reverses_id as string) ?? null, reversed: x.reversed as boolean, recordedBy: x.recorded_by as string, createdAt: iso(x.created_at)!,
    };
  });
}

export async function getInvoice(db: Exec, id: string): Promise<InvoiceDto> {
  const [row] = await db.execute(sql`${LIST} where i.id = ${id}`);
  if (!row) throw notFound('Rechnung');
  const base = toRow(row as Raw);
  const lines = (await db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, id)).orderBy(asc(invoiceLines.pos)))
    .map((l) => ({ id: l.id, pos: l.pos, description: l.description, detail: l.detail, quantity: l.quantity, unitPriceCents: l.unitPriceCents, taxRatePercent: l.taxRatePercent, totalCents: l.totalCents }));
  return {
    ...base, grossCents: base.status === 'draft' ? lines.reduce((s, l) => s + l.totalCents, 0) : base.grossCents,
    issuer: ((row as Raw).issuer as IssuerDto) ?? null, lines, taxes: taxBreakdown(lines),
    payments: await paymentsWhere(db, sql`p.invoice_id = ${id}`),
  };
}

export async function bookingBilling(db: Exec, bookingId: string): Promise<BookingBillingDto> {
  const inv = await listInvoices(db, { bookingId });
  const pays = await paymentsWhere(db, sql`p.booking_id = ${bookingId}`);
  return {
    invoices: inv, payments: pays,
    invoicedCents: inv.filter((i) => i.status === 'issued' && i.kind === 'invoice').reduce((s, i) => s + i.grossCents, 0),
    paidCents: pays.reduce((s, p) => s + p.amountCents, 0),
    unassignedPaidCents: pays.filter((p) => !p.invoiceId).reduce((s, p) => s + p.amountCents, 0),
    uninvoicedCents: await uninvoicedCents(db, bookingId),
  };
}

export async function openSummary(db: Exec) {
  const [r] = await db.execute(sql`
    select count(*)::int as n, coalesce(sum(open), 0)::int as cents, count(*) filter (where due_date < ${todayBerlin()}::date)::int as overdue
    from (select i.due_date, i.gross_cents - coalesce((select sum(p.amount_cents) from payments p where p.invoice_id = i.id), 0) as open
          from invoices i where i.status = 'issued' and i.kind = 'invoice') x where open <> 0`);
  const x = r as Raw;
  return { count: x.n as number, cents: x.cents as number, overdue: x.overdue as number };
}

/**
 * Was von einer Reservierung schon auf einer gültigen Rechnung (Entwurf oder ausgestellt, nicht storniert) steht.
 * legacy = es gibt eine ältere Rechnung ohne Herkunftsangaben; sie gilt als Rechnung über die ganze Reservierung.
 */
async function invoiced(tx: Exec, bookingId: string) {
  const rows = Array.from(await tx.execute(sql`
    select i.id as invoice_id, l.source_kind, l.source_id, l.source_from::text as f, l.source_to::text as t
    from invoices i left join invoice_lines l on l.invoice_id = i.id
    where i.booking_id = ${bookingId} and i.kind = 'invoice' and i.status in ('draft', 'issued')`)) as { invoice_id: string; source_kind: string | null; source_id: string | null; f: string | null; t: string | null }[];
  const nights = new Set<string>(), charges = new Set<string>();
  for (const r of rows) {
    if (r.source_kind === 'night' && r.source_id && r.f && r.t) { for (let d = r.f; d < r.t; d = addDays(d, 1)) nights.add(`${r.source_id}:${d}`); }
    else if (r.source_kind === 'charge' && r.source_id) charges.add(r.source_id);
  }
  // Rechnungen mit Positionen, aber ganz ohne Herkunft (aus Versionen vor 1.18 oder von Hand umgebaut) gelten als Gesamtrechnung
  const lineCount = Array.from(await tx.execute(sql`
    select i.id from invoices i where i.booking_id = ${bookingId} and i.kind = 'invoice' and i.status in ('draft', 'issued')
      and exists (select 1 from invoice_lines l where l.invoice_id = i.id) and not exists (select 1 from invoice_lines l where l.invoice_id = i.id and l.source_kind is not null)`)).length;
  return { nights, charges, legacy: lineCount > 0 };
}

/** Betrag der Reservierung, der noch auf keiner Rechnung steht. */
async function uninvoicedCents(tx: Exec, bookingId: string): Promise<number> {
  const [b, done] = [await getBooking(tx, bookingId), await invoiced(tx, bookingId)];
  if (done.legacy) return 0;
  let cents = 0;
  for (const r of b.rooms.filter((x) => isActiveStatus(x.status))) for (const n of r.nightly ?? []) if (!done.nights.has(`${r.id}:${n.date}`)) cents += n.priceCents;
  for (const c of b.charges) {
    const room = b.rooms.find((r) => r.id === c.bookingRoomId);
    if (room && !isActiveStatus(room.status)) continue;
    if (!done.charges.has(c.id)) cents += c.totalCents;
  }
  return cents;
}

// ---------- Entwürfe ----------
async function lockDraft(tx: Exec, id: string) {
  const [inv] = await tx.select().from(invoices).where(eq(invoices.id, id)).for('update');
  if (!inv) throw notFound('Rechnung');
  if (inv.status !== 'draft') throw conflict('Die Rechnung ist bereits ausgestellt und kann nicht mehr geändert werden. Bei Fehlern bitte stornieren.', 'not_draft');
  return inv;
}

/** Legt einen Rechnungsentwurf an – leer oder mit den Positionen einer Reservierung. */
export async function createInvoice(db: Db, actor: Actor, v: { bookingId?: string; include: 'all' | 'lodging' | 'extras' | 'none' }) {
  return db.transaction(async (tx) => {
    const lines: { description: string; detail: string; quantity: number; unitPriceCents: number; taxRatePercent: number; sourceKind?: 'night' | 'charge'; sourceId?: string; sourceFrom?: string; sourceTo?: string }[] = [];
    let recipient = {};
    let serviceFrom: string | null = null;
    let serviceTo: string | null = null;
    if (v.bookingId) {
      // Reservierung sperren: zwei gleichzeitige Abrechnungen derselben Reservierung laufen nacheinander
      await tx.execute(sql`select 1 from bookings where id = ${v.bookingId} for update`);
      const b = await getBooking(tx, v.bookingId);
      const done = await invoiced(tx, v.bookingId);
      if (done.legacy && v.include !== 'none') throw conflict('Für diese Reservierung gibt es bereits eine Rechnung. Für eine Korrektur die Rechnung stornieren (Administrator) und danach neu abrechnen.', 'already_invoiced');
      const g = b.guest;
      const person = [g.salutation, g.firstName, g.lastName].filter(Boolean).join(' ');
      recipient = {
        recipientCompany: g.company, recipientName: person, recipientStreet: g.street, recipientZip: g.zip, recipientCity: g.city, recipientCountry: g.country,
      };
      // Firmenbuchung: Rechnung an die Firma (Rechnungsanschrift, USt-IdNr., Zahlungsziel der Firma)
      if (b.companyId) {
        const [c] = await tx.select().from(companies).where(eq(companies.id, b.companyId));
        if (c) recipient = {
          recipientCompany: c.name, recipientName: c.contactName ? `z. Hd. ${c.contactName}` : '', recipientStreet: c.street, recipientZip: c.zip,
          recipientCity: c.city, recipientCountry: c.country, recipientVatId: c.vatId, paymentTermDays: c.paymentTermDays,
        };
      }
      const rooms = b.rooms.filter((r) => isActiveStatus(r.status));
      if (rooms.length) {
        serviceFrom = rooms.map((r) => r.from).sort()[0]!;
        serviceTo = rooms.map((r) => r.to).sort().at(-1)!;
      }
      if (v.include === 'all' || v.include === 'lodging') {
        for (const r of rooms) {
          // Nächte mit gleichem Preis und Steuersatz zu einer Position zusammenfassen
          const groups: { price: number; tax: number; from: string; to: string; n: number }[] = [];
          for (const n of r.nightly ?? []) {
            if (done.nights.has(`${r.id}:${n.date}`)) continue; // schon auf einer Rechnung
            const last = groups.at(-1);
            if (last && last.price === n.priceCents && last.tax === n.taxRatePercent && last.to === n.date) { last.n++; last.to = addDays(n.date, 1); }
            else groups.push({ price: n.priceCents, tax: n.taxRatePercent, from: n.date, to: addDays(n.date, 1), n: 1 });
          }
          for (const gr of groups)
            lines.push({ description: `Übernachtung ${r.categoryName}, Zimmer ${r.roomNumber}`, detail: `${de(gr.from)} – ${de(gr.to)}`, quantity: gr.n, unitPriceCents: gr.price, taxRatePercent: gr.tax , sourceKind: 'night', sourceId: r.id, sourceFrom: gr.from, sourceTo: gr.to });
        }
      }
      if (v.include === 'all' || v.include === 'extras') {
        for (const c of b.charges) {
          const room = b.rooms.find((r) => r.id === c.bookingRoomId);
          if (room && !isActiveStatus(room.status)) continue;
          if (done.charges.has(c.id)) continue; // schon auf einer Rechnung
          lines.push({ description: c.name, detail: room ? `Zimmer ${room.roomNumber}` : '', quantity: c.quantity, unitPriceCents: c.unitPriceCents, taxRatePercent: c.taxRatePercent, sourceKind: 'charge', sourceId: c.id });
        }
      }
    }
    if (v.bookingId && v.include !== 'none' && lines.length === 0) throw conflict('Alle Leistungen dieser Reservierung stehen bereits auf einer Rechnung', 'already_invoiced');
    const [inv] = await tx.insert(invoices).values({ bookingId: v.bookingId ?? null, ...recipient, serviceFrom, serviceTo, createdBy: actor.userName }).returning();
    if (lines.length)
      await tx.insert(invoiceLines).values(lines.map((l, i) => ({ ...l, invoiceId: inv!.id, pos: i + 1, totalCents: Math.round(l.quantity * l.unitPriceCents) })));
    await record(tx, actor, { action: 'create', entity: 'invoice', entityId: inv!.id, after: { bookingId: v.bookingId ?? null, include: v.include, lines: lines.length } });
    return { id: inv!.id };
  });
}

export async function updateDraft(db: Db, actor: Actor, id: string, v: Record<string, unknown> & { version: number }) {
  await db.transaction(async (tx) => {
    const before = await lockDraft(tx, id);
    if (before.version !== v.version) throw stale();
    const { version: _v, ...set } = v;
    await tx.update(invoices).set({ ...set, version: before.version + 1, updatedAt: new Date() }).where(eq(invoices.id, id));
    await record(tx, actor, { action: 'update', entity: 'invoice', entityId: id, after: set });
  });
}

export async function addLine(db: Db, actor: Actor, id: string, l: { description: string; detail: string; quantity: number; unitPriceCents: number; taxRatePercent: number }) {
  await db.transaction(async (tx) => {
    await lockDraft(tx, id);
    const [{ n }] = (await tx.select({ n: sql<number>`coalesce(max(${invoiceLines.pos}), 0)::int` }).from(invoiceLines).where(eq(invoiceLines.invoiceId, id))) as [{ n: number }];
    await tx.insert(invoiceLines).values({ ...l, invoiceId: id, pos: n + 1, totalCents: Math.round(l.quantity * l.unitPriceCents) });
    await record(tx, actor, { action: 'line_add', entity: 'invoice', entityId: id, after: l });
  });
}

export async function removeLine(db: Db, actor: Actor, lineId: string) {
  return db.transaction(async (tx) => {
    const [line] = await tx.select().from(invoiceLines).where(eq(invoiceLines.id, lineId));
    if (!line) throw notFound('Position');
    await lockDraft(tx, line.invoiceId);
    await tx.delete(invoiceLines).where(eq(invoiceLines.id, lineId));
    await record(tx, actor, { action: 'line_remove', entity: 'invoice', entityId: line.invoiceId, before: { description: line.description, totalCents: line.totalCents } });
    return { invoiceId: line.invoiceId };
  });
}

export async function deleteDraft(db: Db, actor: Actor, id: string) {
  await db.transaction(async (tx) => {
    await lockDraft(tx, id);
    await tx.delete(invoices).where(eq(invoices.id, id));
    await record(tx, actor, { action: 'remove', entity: 'invoice', entityId: id });
  });
}

// ---------- Ausstellen und Stornieren ----------
async function nextInvoiceNumber(tx: Tx, prefix: string, year: number) {
  // Zeile des Nummernkreises wird gesperrt: gleichzeitige Ausstellungen erhalten fortlaufende Nummern ohne Lücke
  const [row] = await tx.insert(numberSequences).values({ key: 'invoice', year, last: 1 })
    .onConflictDoUpdate({ target: [numberSequences.key, numberSequences.year], set: { last: sql`${numberSequences.last} + 1` } }).returning();
  return `${prefix ? prefix + '-' : ''}${year}-${String(row!.last).padStart(4, '0')}`;
}

async function issuerSnapshot(tx: Exec): Promise<IssuerDto> {
  const h = await getHotel(tx);
  const missing: string[] = [];
  if (!h.name) missing.push('Name');
  if (!h.street || !h.zip || !h.city) missing.push('Anschrift');
  if (!h.taxNumber && !h.vatId) missing.push('Steuernummer oder USt-IdNr.');
  if (missing.length) throw new AppError(409, 'issuer_incomplete', `Für Rechnungen fehlen in den Einstellungen: ${missing.join(', ')}`);
  return {
    name: h.name, street: h.street, zip: h.zip, city: h.city, country: h.country, phone: h.phone, email: h.email, website: h.website,
    taxNumber: h.taxNumber, vatId: h.vatId, bankName: h.bankName, iban: h.iban, bic: h.bic, footer: h.invoiceFooter,
  };
}

export async function issueInvoice(db: Db, actor: Actor, id: string, version: number) {
  return db.transaction(async (tx) => {
    const inv = await lockDraft(tx, id);
    if (inv.version !== version) throw stale();
    const lines = await tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, id));
    if (!lines.length) throw conflict('Die Rechnung hat keine Positionen');
    if (!inv.recipientName && !inv.recipientCompany) throw conflict('Bitte den Rechnungsempfänger angeben');
    const issuer = await issuerSnapshot(tx);
    const h = await getHotel(tx);
    const today = todayBerlin();
    const number = await nextInvoiceNumber(tx, h.invoicePrefix, Number(today.slice(0, 4)));
    const gross = lines.reduce((s, l) => s + l.totalCents, 0);
    await tx.update(invoices).set({
      number, status: 'issued', issueDate: today, dueDate: addDays(today, inv.paymentTermDays ?? h.paymentTermDays), issuer, grossCents: gross,
      serviceFrom: inv.serviceFrom ?? today, serviceTo: inv.serviceTo ?? today,
      issuedBy: actor.userName, issuedAt: new Date(), version: inv.version + 1, updatedAt: new Date(),
    }).where(eq(invoices.id, id));
    // Anzahlungen der Reservierung, die noch keiner Rechnung zugeordnet sind, werden mit dieser Rechnung verrechnet
    let deposits = 0;
    if (inv.bookingId) {
      const moved = await tx.update(payments).set({ invoiceId: id }).where(and(eq(payments.bookingId, inv.bookingId), isNull(payments.invoiceId))).returning();
      deposits = moved.reduce((s, p) => s + p.amountCents, 0);
    }
    await record(tx, actor, { action: 'issue', entity: 'invoice', entityId: id, after: { number, grossCents: gross, deposits } });
    return { number };
  });
}

/** Storniert eine ausgestellte Rechnung durch einen Stornobeleg mit eigener Nummer und negativen Positionen. */
export async function cancelInvoice(db: Db, actor: Actor, id: string, reason: string) {
  return db.transaction(async (tx) => {
    const [inv] = await tx.select().from(invoices).where(eq(invoices.id, id)).for('update');
    if (!inv) throw notFound('Rechnung');
    if (inv.kind !== 'invoice' || inv.status !== 'issued') throw conflict('Nur ausgestellte Rechnungen können storniert werden');
    const lines = await tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, id)).orderBy(asc(invoiceLines.pos));
    const issuer = await issuerSnapshot(tx);
    const h = await getHotel(tx);
    const today = todayBerlin();
    const number = await nextInvoiceNumber(tx, h.invoicePrefix, Number(today.slice(0, 4)));
    const [st] = await tx.insert(invoices).values({
      number, kind: 'cancellation', status: 'draft', bookingId: inv.bookingId, cancelsId: id,
      recipientCompany: inv.recipientCompany, recipientName: inv.recipientName, recipientStreet: inv.recipientStreet, recipientZip: inv.recipientZip,
      recipientCity: inv.recipientCity, recipientCountry: inv.recipientCountry, recipientVatId: inv.recipientVatId,
      serviceFrom: inv.serviceFrom, serviceTo: inv.serviceTo, notes: `Storno der Rechnung ${inv.number} vom ${de(inv.issueDate!)}. Grund: ${reason}`,
      createdBy: actor.userName,
    }).returning();
    await tx.insert(invoiceLines).values(lines.map((l) => ({
      invoiceId: st!.id, pos: l.pos, description: l.description, detail: l.detail, quantity: l.quantity, unitPriceCents: -l.unitPriceCents, taxRatePercent: l.taxRatePercent, totalCents: -l.totalCents,
    })));
    await tx.update(invoices).set({
      status: 'issued', issueDate: today, issuer, grossCents: -inv.grossCents, issuedBy: actor.userName, issuedAt: new Date(), updatedAt: new Date(),
    }).where(eq(invoices.id, st!.id));
    await tx.update(invoices).set({ status: 'cancelled', cancelReason: reason, version: inv.version + 1, updatedAt: new Date() }).where(eq(invoices.id, id));

    // Bereits gezahlte Beträge: Gegenbuchung auf der stornierten Rechnung und Übertrag als Anzahlung auf die Reservierung,
    // damit sie mit der korrigierten Rechnung verrechnet werden.
    if (inv.bookingId) {
      const byMethod = await tx.execute(sql`select method, sum(amount_cents)::int as s from payments where invoice_id = ${id} group by method having sum(amount_cents) <> 0`);
      for (const r of Array.from(byMethod)) {
        const { method, s } = r as { method: string; s: number };
        await tx.insert(payments).values([
          { invoiceId: id, bookingId: inv.bookingId, amountCents: -s, method, date: today, note: `Übertrag wegen Storno ${number}`, recordedBy: actor.userName },
          { bookingId: inv.bookingId, amountCents: s, method, date: today, note: `Übertrag von stornierter Rechnung ${inv.number}`, recordedBy: actor.userName },
        ]);
      }
    }
    await record(tx, actor, { action: 'cancel', entity: 'invoice', entityId: id, after: { number: inv.number, cancellation: number, reason } });
    return { id: st!.id, number };
  });
}

// ---------- Zahlungen ----------
interface PayIn { bookingId?: string; invoiceId?: string; amountCents: number; method: string; date: string; payer: string; note: string; givenCents?: number | null }

/** Schutz vor versehentlichem Doppelklick: dieselbe Zahlung desselben Benutzers innerhalb weniger Sekunden. */
async function refuseRepeat(tx: Exec, actor: Actor, v: { bookingId: string | null; amountCents: number; method: string }) {
  if (!v.bookingId) return;
  const [dup] = await tx.execute(sql`
    select 1 from payments where booking_id = ${v.bookingId} and amount_cents = ${v.amountCents} and method = ${v.method}
      and recorded_by = ${actor.userName} and reverses_id is null and created_at > now() - interval '8 seconds' limit 1`);
  if (dup) throw conflict('Diese Zahlung wurde gerade eben schon gebucht. Bitte die Zahlungsliste prüfen, bevor erneut gebucht wird.', 'duplicate_payment');
}
const euro = (c: number) => (c / 100).toFixed(2).replace('.', ',') + ' €';

async function insertPayment(tx: Exec, actor: Actor, v: { bookingId: string | null; invoiceId: string | null; amountCents: number; method: string; date: string; payer: string; note: string; givenCents?: number | null }) {
  const [p] = await tx.insert(payments).values({ ...v, givenCents: v.givenCents ?? null, recordedBy: actor.userName }).returning();
  await record(tx, actor, { action: 'payment', entity: 'payment', entityId: p!.id, after: { bookingId: v.bookingId, invoiceId: v.invoiceId, amountCents: v.amountCents, method: v.method, date: v.date } });
  return p!.id;
}

export async function addPayment(db: Db, actor: Actor, v: PayIn) {
  if (v.date > todayBerlin()) throw new AppError(400, 'validation', 'Bitte die Eingaben prüfen', { date: 'Das Datum liegt in der Zukunft' });
  if (v.givenCents != null && v.givenCents < v.amountCents) throw new AppError(400, 'validation', 'Bitte die Eingaben prüfen', { givenCents: 'Der gegebene Betrag ist kleiner als der Zahlbetrag' });
  // Zahlung auf die Reservierung: wird zuerst auf offene Rechnungen verteilt, der Rest ist Anzahlung
  if (!v.invoiceId && v.bookingId && v.amountCents > 0) return payBooking(db, actor, { ...v, bookingId: v.bookingId });
  return db.transaction(async (tx) => {
    let bookingId = v.bookingId ?? null;
    if (v.invoiceId) {
      const [inv] = await tx.select().from(invoices).where(eq(invoices.id, v.invoiceId)).for('update');
      if (!inv) throw notFound('Rechnung');
      if (inv.status !== 'issued' || inv.kind !== 'invoice') throw conflict('Zahlungen können nur auf ausgestellte, nicht stornierte Rechnungen gebucht werden');
      if (bookingId && inv.bookingId && bookingId !== inv.bookingId) throw conflict('Rechnung gehört zu einer anderen Reservierung');
      bookingId = inv.bookingId;
      const [{ paid }] = (await tx.execute(sql`select coalesce(sum(amount_cents), 0)::int as paid from payments where invoice_id = ${v.invoiceId}`)) as unknown as [{ paid: number }];
      const open = inv.grossCents - paid;
      if (v.amountCents > 0 && v.amountCents > open) throw conflict(open > 0 ? `Auf dieser Rechnung sind nur noch ${euro(open)} offen` : 'Diese Rechnung ist bereits vollständig bezahlt', 'overpay');
    } else {
      const [b] = await tx.select({ id: bookings.id }).from(bookings).where(eq(bookings.id, bookingId!));
      if (!b) throw notFound('Reservierung');
    }
    await refuseRepeat(tx, actor, { bookingId, amountCents: v.amountCents, method: v.method });
    return { id: await insertPayment(tx, actor, { bookingId, invoiceId: v.invoiceId ?? null, amountCents: v.amountCents, method: v.method, date: v.date, payer: v.payer, note: v.note, givenCents: v.givenCents }) };
  });
}

/**
 * Zahlung zu einer Reservierung: Der Betrag wird auf die offenen Rechnungen der Reservierung verteilt (älteste zuerst),
 * ein Rest wird als Anzahlung gebucht und mit der nächsten Rechnung verrechnet. Mehr als der offene Gesamtbetrag ist nicht möglich.
 */
export async function payBooking(db: Db, actor: Actor, v: PayIn & { bookingId: string }) {
  return db.transaction(async (tx) => {
    const [locked] = await tx.execute(sql`select id from bookings where id = ${v.bookingId} for update`);
    if (!locked) throw notFound('Reservierung');
    const b = await getBooking(tx, v.bookingId);
    const bill = await bookingBilling(tx, v.bookingId);
    const total = b.rooms.filter((r) => isActiveStatus(r.status)).reduce((s, r) => s + r.lodgingCents, 0) + b.chargesCents;
    const openInvoices = bill.invoices.filter((i) => i.status === 'issued' && i.kind === 'invoice' && i.openCents > 0).sort((x, y) => (x.issuedAt ?? '').localeCompare(y.issuedAt ?? ''));
    // offen ist, was auf Rechnungen noch fehlt, mindestens aber der Rest der Reservierung
    const remaining = Math.max(total - bill.paidCents, openInvoices.reduce((s, i) => s + i.openCents, 0));
    if (v.amountCents > remaining) throw conflict(remaining > 0 ? `Für diese Reservierung sind nur noch ${euro(remaining)} offen` : 'Für diese Reservierung ist nichts mehr offen', 'overpay');
    await refuseRepeat(tx, actor, { bookingId: v.bookingId, amountCents: v.amountCents, method: v.method });
    let rest = v.amountCents;
    let first: string | null = null;
    const base = { bookingId: v.bookingId, method: v.method, date: v.date, payer: v.payer, note: v.note };
    for (const i of openInvoices) {
      if (rest <= 0) break;
      const part = Math.min(rest, i.openCents);
      // der gegebene Betrag steht nur an der ersten Teilbuchung
      const id = await insertPayment(tx, actor, { ...base, invoiceId: i.id, amountCents: part, givenCents: first ? null : v.givenCents != null ? v.givenCents - (v.amountCents - part) : null });
      first ??= id;
      rest -= part;
    }
    if (rest > 0) { const id = await insertPayment(tx, actor, { ...base, invoiceId: null, amountCents: rest, givenCents: first ? null : v.givenCents }); first ??= id; }
    return { id: first! };
  });
}

/** Fehlerhafte Zahlung korrigieren: Gegenbuchung mit umgekehrtem Vorzeichen; das Original bleibt erhalten. */
export async function reversePayment(db: Db, actor: Actor, id: string, note: string) {
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(payments).where(eq(payments.id, id)).for('update');
    if (!p) throw notFound('Zahlung');
    if (p.reversesId) throw conflict('Eine Gegenbuchung kann nicht erneut gegengebucht werden');
    const [done] = await tx.select({ id: payments.id }).from(payments).where(eq(payments.reversesId, id));
    if (done) throw conflict('Diese Zahlung wurde bereits gegengebucht');
    const [r] = await tx.insert(payments).values({
      bookingId: p.bookingId, invoiceId: p.invoiceId, amountCents: -p.amountCents, method: p.method, date: todayBerlin(), payer: p.payer, note, reversesId: id, recordedBy: actor.userName,
    }).returning();
    await record(tx, actor, { action: 'reverse', entity: 'payment', entityId: id, after: { amountCents: -p.amountCents, note } });
    return { id: r!.id, bookingId: p.bookingId, invoiceId: p.invoiceId };
  });
}

// ---------- Export für die Buchhaltung ----------
export async function exportCsv(db: Exec, from: string, to: string) {
  const rows = (await listInvoices(db, { from, to })).filter((i) => i.status !== 'draft').reverse();
  const ids = rows.map((r) => r.id);
  const lines = ids.length ? await db.select().from(invoiceLines).where(sql`${invoiceLines.invoiceId} in ${ids}`) : [];
  const rates = [...new Set(lines.map((l) => l.taxRatePercent))].sort((a, b) => a - b);
  const eur = (c: number) => (c / 100).toFixed(2).replace('.', ',');
  const cell = (v: string) => {
    let s = v;
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s)) s = "'" + s; // keine Formelausführung in Tabellenprogrammen
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const head = ['Rechnungsnummer', 'Datum', 'Art', 'Status', 'Storno zu', 'Empfänger', 'USt-IdNr. Empfänger', 'Leistung von', 'Leistung bis', 'Reservierung',
    ...rates.flatMap((r) => [`Netto ${String(r).replace('.', ',')} %`, `USt ${String(r).replace('.', ',')} %`]), 'Brutto', 'Bezahlt', 'Offen'];
  const body = rows.map((i) => {
    const t = taxBreakdown(lines.filter((l) => l.invoiceId === i.id));
    return [i.number ?? '', i.issueDate ? de(i.issueDate) : '', i.kind === 'cancellation' ? 'Stornobeleg' : 'Rechnung', i.status === 'cancelled' ? 'storniert' : 'gültig',
      i.cancelsNumber ?? '', [i.recipientCompany, i.recipientName].filter(Boolean).join(', '), i.recipientVatId, i.serviceFrom ? de(i.serviceFrom) : '', i.serviceTo ? de(i.serviceTo) : '',
      i.bookingNumber ?? '', ...rates.flatMap((r) => { const x = t.find((y) => y.rate === r); return [x ? eur(x.netCents) : '', x ? eur(x.taxCents) : '']; }),
      eur(i.grossCents), eur(i.paidCents), eur(i.openCents)].map(cell).join(';');
  });
  return '﻿' + [head.map(cell).join(';'), ...body].join('\r\n');
}

export async function exportPaymentsCsv(db: Exec, from: string, to: string) {
  const list = await paymentsWhere(db, sql`p.date >= ${from}::date and p.date <= ${to}::date`);
  const bookingNumbers = new Map(Array.from(await db.execute(sql`select id, number from bookings`)).map((r) => [(r as Raw).id as string, (r as Raw).number as string]));
  const cell = (v: string) => '"' + v.replace(/"/g, '""') + '"';
  const head = ['Datum', 'Betrag', 'Zahlungsart', 'Rechnung', 'Reservierung', 'Zahler', 'Bemerkung', 'Erfasst von'];
  const body = list.map((p) => [de(p.date), (p.amountCents / 100).toFixed(2).replace('.', ','), p.method, p.invoiceNumber ?? '', p.bookingId ? bookingNumbers.get(p.bookingId) ?? '' : '', p.payer, p.note, p.recordedBy].map(cell).join(';'));
  return '﻿' + [head.map(cell).join(';'), ...body].join('\r\n');
}


// ---------- Logo und Rechnungs-PDF ----------
export async function getLogo(db: Exec): Promise<Logo | null> {
  const [row] = await db.select().from(settings).where(eq(settings.key, 'logo'));
  const v = row?.value as { mime?: Logo['mime']; data?: string } | undefined;
  return v?.mime && v.data ? { mime: v.mime, data: Buffer.from(v.data, 'base64') } : null;
}
export async function saveLogo(db: Db, actor: Actor, v: { mime: Logo['mime']; dataBase64: string } | null) {
  if (!v) await db.delete(settings).where(eq(settings.key, 'logo'));
  else {
    const data = Buffer.from(v.dataBase64, 'base64');
    if (data.length > 400 * 1024) throw new AppError(400, 'too_large', 'Das Logo ist zu groß (höchstens 400 kB)');
    const png = data.subarray(0, 8).toString('hex') === '89504e470d0a1a0a', jpg = data[0] === 0xff && data[1] === 0xd8;
    if ((v.mime === 'image/png' && !png) || (v.mime === 'image/jpeg' && !jpg)) throw new AppError(400, 'bad_image', 'Die Datei ist kein gültiges PNG- oder JPEG-Bild');
    const value = { mime: v.mime, data: data.toString('base64') };
    await db.insert(settings).values({ key: 'logo', value }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
  }
  await record(db, actor, { action: 'update', entity: 'settings', entityId: 'logo', after: { logo: v ? `${v.mime}` : 'entfernt' } });
}

/**
 * PDF einer Rechnung. Ausgestellte Rechnungen und Stornobelege werden beim ersten Abruf (spätestens direkt nach dem Ausstellen)
 * erzeugt und als Archivkopie gespeichert; danach kommt immer genau diese Datei zurück. Entwürfe werden jedes Mal neu gezeichnet.
 */
export async function invoicePdf(db: Db, id: string): Promise<{ filename: string; pdf: Buffer; archived: boolean }> {
  const inv = await getInvoice(db, id);
  const name = `${(inv.number ?? 'Entwurf').replace(/[^A-Za-z0-9._-]+/g, '_')}.pdf`;
  if (inv.status !== 'draft') {
    const [doc] = await db.select().from(invoiceDocuments).where(eq(invoiceDocuments.invoiceId, id));
    if (doc) return { filename: name, pdf: doc.pdf, archived: true };
  }
  const h = await getHotel(db);
  const issuer: IssuerDto = inv.issuer ?? { name: h.name, street: h.street, zip: h.zip, city: h.city, country: h.country, phone: h.phone, email: h.email, website: h.website,
    taxNumber: h.taxNumber, vatId: h.vatId, bankName: h.bankName, iban: h.iban, bic: h.bic, footer: h.invoiceFooter };
  const pdf = Buffer.from(await renderInvoice(inv, issuer, await getLogo(db)));
  if (inv.status === 'draft') return { filename: name, pdf, archived: false };
  // gleichzeitige Abrufe: die zuerst gespeicherte Kopie gilt
  await db.insert(invoiceDocuments).values({ invoiceId: id, pdf }).onConflictDoNothing();
  const [doc] = await db.select().from(invoiceDocuments).where(eq(invoiceDocuments.invoiceId, id));
  return { filename: name, pdf: doc!.pdf, archived: true };
}

// ---------- Rechnungsnummern: Startwert ----------
const numberOf = (prefix: string, year: number, n: number) => `${prefix ? prefix + '-' : ''}${year}-${String(n).padStart(4, '0')}`;
export async function invoiceNumberState(db: Exec, year: number): Promise<InvoiceNumberState> {
  const [seq] = await db.select().from(numberSequences).where(and(eq(numberSequences.key, 'invoice'), eq(numberSequences.year, year)));
  const [n] = await db.execute(sql`select count(*)::int as n from invoices where number is not null and extract(year from issue_date) = ${year}`);
  const last = seq?.last ?? 0;
  return { year, next: last + 1, issued: Number(n!.n) > 0 ? last : 0, sample: numberOf((await getHotel(db)).invoicePrefix, year, last + 1) };
}
/**
 * Nächste Rechnungsnummer eines Jahres festlegen – für den Start mitten im Jahr, wenn es schon Rechnungen mit früheren Nummern gibt.
 * Nur nach oben: Eine Nummer, die das Programm schon vergeben hat, wird nie noch einmal vergeben.
 */
export async function setInvoiceNumber(db: Db, actor: Actor, v: { year: number; next: number }) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(4713)`);
    const [seq] = await tx.select().from(numberSequences).where(and(eq(numberSequences.key, 'invoice'), eq(numberSequences.year, v.year)));
    const last = seq?.last ?? 0;
    if (v.next <= last) throw conflict(`Die Nummer ${last} ist in ${v.year} schon vergeben oder übersprungen – die nächste Nummer muss mindestens ${last + 1} sein.`, 'number_taken');
    await tx.insert(numberSequences).values({ key: 'invoice', year: v.year, last: v.next - 1 })
      .onConflictDoUpdate({ target: [numberSequences.key, numberSequences.year], set: { last: v.next - 1 } });
    await record(tx, actor, { action: 'update', entity: 'settings', entityId: 'invoice_number', before: { year: v.year, next: last + 1 }, after: v });
    return invoiceNumberState(tx, v.year);
  });
}
