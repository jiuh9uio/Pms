import { useState } from 'react';
import { formatMoney, moneyInput } from '../../../src/shared/hotel.js';
import { UNIT_LABEL, groupItems, lineTotal, quantityFor, spanOf, type OfferDto, type OfferItemDto, type OfferTemplateDto } from '../../../src/shared/offers.js';
import { api } from '../api.ts';
import { useData } from '../data.tsx';
import { Button, Dialog, Field, LoadState, useLoad, useToast } from '../ui.tsx';

/**
 * Absprache am Tisch: geführter Ablauf wie bei der Zimmerbuchung – Anlass → allgemeine Daten → Leistungen je Gruppe → Übersicht.
 * Am Ende entsteht ein Angebot als Entwurf (noch nichts versendet); es lässt sich danach wie jedes Angebot bearbeiten.
 */
const qty = (s: string) => Number(s.replace(',', '.'));

export function OfferWizard({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { bump } = useData();
  const toast = useToast();
  const tplLoad = useLoad(() => api<OfferTemplateDto[]>('GET', '/offer-templates'));
  const allItems = useLoad(() => api<OfferItemDto[]>('GET', '/offer-items')).data ?? [];
  const tpls = (tplLoad.data ?? []).filter((t) => t.active);
  const [tplId, setTplId] = useState<string | null>(null);
  const [v, setV] = useState({ customerCompany: '', customerName: '', phone: '', email: '', eventDate: '', eventEnd: '', persons: '10', wishes: '' });
  /** Auswahl: Leistungs-ID → Menge (Text); null = Menge automatisch aus Personen und Tagen */
  const [sel, setSel] = useState<Record<string, string | null>>({});
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<string | null>(null);

  const tpl = tpls.find((t) => t.id === tplId);
  const items = (tpl?.items ?? []).map((c) => allItems.find((x) => x.id === c.itemId && x.active)).filter((x): x is OfferItemDto => !!x);
  const groups = groupItems(items);
  const persons = Number(v.persons) || 0;
  const auto = (it: OfferItemDto) => quantityFor(it.unit, persons || 1, v.eventDate || null, v.eventEnd || null);
  const qtyText = (it: OfferItemDto) => sel[it.id] ?? String(auto(it)).replace('.', ',');
  const sumOf = (it: OfferItemDto) => { const n = qty(qtyText(it)); return Number.isFinite(n) ? lineTotal(n, it.priceCents) : 0; };
  const chosen = items.filter((it) => it.id in sel);
  const total = chosen.reduce((s, it) => s + sumOf(it), 0);
  // Schritte: 0 Anlass, 1 Daten, 2 … Gruppen, zuletzt Übersicht
  const names = ['Anlass', 'Daten', ...groups.map((g) => g.name), 'Übersicht'];
  const last = names.length - 1;
  const g = step >= 2 && step < last ? groups[step - 2] : undefined;

  const pickTpl = (t: OfferTemplateDto) => {
    setTplId(t.id);
    // „gleich ins Angebot“ ist vorausgewählt
    setSel(Object.fromEntries(t.items.filter((c) => c.preselect !== false && allItems.some((x) => x.id === c.itemId && x.active)).map((c) => [c.itemId, c.quantity != null ? String(c.quantity).replace('.', ',') : null])));
    setStep(1);
  };
  const dataError = () => (!v.customerName.trim() && !v.customerCompany.trim() ? 'Bitte einen Namen oder eine Firma eintragen.'
    : persons < 1 ? 'Bitte die Personenzahl eintragen.'
    : v.eventEnd && v.eventDate && v.eventEnd < v.eventDate ? 'Das Ende liegt vor dem Beginn.' : null);
  const go = (n: number) => {
    if (n >= 1 && !tpl) { setFail('Bitte zuerst den Anlass wählen.'); setStep(0); return; }
    if (n >= 2) { const e = dataError(); if (e) { setFail(e); setStep(1); return; } }
    setFail(null); setStep(n);
  };
  const toggle = (it: OfferItemDto) => setSel((s) => { const n = { ...s }; if (it.id in n) delete n[it.id]; else n[it.id] = null; return n; });

  const create = async () => {
    const bad = chosen.find((it) => { const n = qty(qtyText(it)); return !Number.isFinite(n) || n < 0; });
    if (bad) { setFail(`Bitte bei „${bad.name}“ eine Menge eintragen.`); return; }
    setBusy(true); setFail(null);
    let id: string | null = null;
    try {
      const r = await api<{ id: string; number: string }>('POST', '/offers', { templateId: tplId, mode: 'offer', area: 'both', customerCompany: v.customerCompany, customerName: v.customerName, email: v.email, phone: v.phone,
        eventDate: v.eventDate || null, eventEnd: v.eventEnd || null, persons });
      id = r.id;
      const o = await api<OfferDto>('GET', `/offers/${r.id}`);
      const note = v.wishes.trim() ? `Absprache am ${new Date().toLocaleDateString('de-DE')}: ${v.wishes.trim()}` : '';
      await api('PUT', `/offers/${r.id}`, { ...o, notes: note,
        lines: groups.flatMap((x) => x.items).filter((it) => it.id in sel).map((it) => ({ itemId: it.id, description: it.name, detail: it.description, unit: it.unit, quantity: qty(qtyText(it)), unitPriceCents: it.priceCents, taxRatePercent: it.taxRatePercent })),
        version: o.version });
      toast(`Angebot ${r.number} als Entwurf angelegt`); bump(); onCreated(r.id);
    } catch (e) {
      const err = e as { message?: string; fields?: Record<string, string> };
      const msg = Object.values(err.fields ?? {}).join(' · ') || err.message || 'Fehler';
      // schon angelegt, aber die Auswahl ließ sich nicht speichern → das Angebot öffnen, damit nichts doppelt entsteht
      if (id) { toast(`Angebot angelegt, aber die Auswahl wurde nicht gespeichert: ${msg}`, 'error'); bump(); onCreated(id); }
      else setFail(msg);
    }
    setBusy(false);
  };
  const set = (k: keyof typeof v, x: string) => setV({ ...v, [k]: x });
  const span = spanOf(v.eventDate || null, v.eventEnd || null);
  const dirty = !!tplId || !!v.customerName || !!v.customerCompany;
  return (
    <Dialog title="Absprache – Schritt für Schritt" size="xl" onClose={() => { if (!dirty || window.confirm('Die Eingaben verwerfen?')) onClose(); }}
      footer={<>
        {step >= 2 && <span className="left total">Summe <b>{formatMoney(total)}</b></span>}
        {step > 0 && <Button onClick={() => go(step - 1)}>Zurück</Button>}
        {step > 0 && step < last && <Button variant="primary" onClick={() => go(step + 1)}>Weiter</Button>}
        {step === last && <Button variant="primary" busy={busy} onClick={() => void create()}>Angebot anlegen</Button>}
      </>}>
      <ol className="cfg-steps">{names.map((n, i) => {
        const count = i >= 2 && i < last ? groups[i - 2]!.items.filter((it) => it.id in sel).length : 0;
        return <li key={`${i}-${n}`}><button type="button" className={i === step ? 'on' : count || (i < step && i < 2) ? 'done' : ''} onClick={() => go(i)}><span>{i === last ? '✓' : i + 1}</span>{n}{count > 0 && <small>{count}</small>}</button></li>;
      })}</ol>
      {fail && <p className="notice danger" role="alert">{fail}</p>}

      {step === 0 && <>
        <h3 className="first">Worum geht es?</h3>
        <LoadState error={tplLoad.error} loading={!tplLoad.data} />
        <div className="cfg-grid">{tpls.map((t) => (
          <div key={t.id} className={`cfg-card${t.id === tplId ? ' on' : ''}`}>
            <button type="button" className="cfg-pick" onClick={() => pickTpl(t)}>
              <span className="cfg-box" aria-hidden="true">{t.id === tplId ? '✓' : ''}</span>
              <span className="cfg-name">{t.name}<small>{t.items.length ? `${t.items.length} Leistungen im Katalog` : 'noch kein Katalog hinterlegt'}</small></span>
              <span />
            </button>
          </div>
        ))}</div>
        {tplLoad.data && tpls.length === 0 && <p className="muted">Noch keine Vorlagen angelegt (Angebote → Vorlagen, Administrator).</p>}
      </>}

      {step === 1 && <>
        <h3 className="first">Allgemeine Daten</h3>
        <div className="formgrid">
          <Field label="Name (Ansprechpartner)"><input value={v.customerName} onChange={(e) => set('customerName', e.target.value)} autoFocus /></Field>
          <Field label="Firma / Verein (falls vorhanden)"><input value={v.customerCompany} onChange={(e) => set('customerCompany', e.target.value)} /></Field>
          <Field label="Telefon"><input type="tel" value={v.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
          <Field label="E-Mail"><input type="email" value={v.email} onChange={(e) => set('email', e.target.value)} /></Field>
          <Field label="Termin"><input type="date" value={v.eventDate} onChange={(e) => set('eventDate', e.target.value)} /></Field>
          <Field label="bis (nur bei mehreren Tagen)"><input type="date" value={v.eventEnd} min={v.eventDate || undefined} onChange={(e) => set('eventEnd', e.target.value)} /></Field>
          <Field label="Personen"><input inputMode="numeric" value={v.persons} onChange={(e) => set('persons', e.target.value)} /></Field>
        </div>
      </>}

      {g && <>
        <p className="muted small">Für {persons} {persons === 1 ? 'Person' : 'Personen'}{span.days > 1 ? `, ${span.days} Tage` : ''}. Die Menge wird vorgeschlagen und lässt sich ändern.</p>
        <div className="cfg-grid">{g.items.map((it) => { const on = it.id in sel; return (
          <div key={it.id} className={`cfg-card${on ? ' on' : ''}`}>
            <button type="button" className="cfg-pick" aria-pressed={on} onClick={() => toggle(it)}>
              <span className="cfg-box" aria-hidden="true">{on ? '✓' : ''}</span>
              <span className="cfg-name">{it.name}{it.description && <small>{it.description}</small>}</span>
              <span className="cfg-price">{formatMoney(it.priceCents)}<small>{UNIT_LABEL[it.unit]}</small></span>
            </button>
            {on && <div className="cfg-qty"><label>Menge <input inputMode="decimal" className="numinput" value={qtyText(it)} onChange={(e) => setSel({ ...sel, [it.id]: e.target.value })} aria-label={`Menge ${it.name}`} /></label><b>{formatMoney(sumOf(it))}</b></div>}
          </div>
        ); })}</div>
      </>}
      {step >= 2 && step < last && !g && <p className="muted">Keine Leistungen in diesem Schritt.</p>}

      {step === last && <>
        <h3 className="first">{tpl?.name} – {[v.customerCompany, v.customerName].filter(Boolean).join(', ')}</h3>
        <p className="muted small">{persons} {persons === 1 ? 'Person' : 'Personen'}{v.eventDate ? ` · ${new Date(`${v.eventDate}T12:00:00`).toLocaleDateString('de-DE')}${v.eventEnd && v.eventEnd !== v.eventDate ? ` bis ${new Date(`${v.eventEnd}T12:00:00`).toLocaleDateString('de-DE')}` : ''}` : ' · Termin noch offen'}{v.phone ? ` · ${v.phone}` : ''}{v.email ? ` · ${v.email}` : ''}</p>
        {chosen.length === 0 ? <p className="muted">{items.length ? 'Noch keine Leistung ausgewählt – das Angebot wird leer angelegt.' : 'Für diesen Anlass ist noch kein Katalog hinterlegt – das Angebot wird leer angelegt.'}</p> : (
          <div className="tablewrap"><table><thead><tr><th>Leistung</th><th className="num">Menge</th><th className="num">Einzelpreis</th><th className="num">Gesamt</th></tr></thead>
            <tbody>
              {groups.map((x) => x.items.filter((it) => it.id in sel).map((it) => <tr key={it.id}><td><b>{it.name}</b> <small className="muted">{x.name}</small></td><td className="num">{qtyText(it)}</td><td className="num">{moneyInput(it.priceCents)} € <small className="muted">{UNIT_LABEL[it.unit]}</small></td><td className="num">{formatMoney(sumOf(it))}</td></tr>))}
              <tr><td colSpan={3}><b>Summe</b> <small className="muted">inkl. Umsatzsteuer</small></td><td className="num"><b>{formatMoney(total)}</b></td></tr>
            </tbody></table></div>
        )}
        <Field label="Wünsche und Absprachen (interne Notiz)" wide><textarea rows={3} value={v.wishes} onChange={(e) => set('wishes', e.target.value)} placeholder="z. B. Beginn 9 Uhr, zwei Vegetarier, Tische in U-Form" /></Field>
        <p className="muted small">„Angebot anlegen“ speichert alles als <b>Entwurf</b>. Es wird noch nichts an den Kunden geschickt – das Angebot öffnet sich danach und lässt sich ändern, als PDF ansehen und senden.</p>
      </>}
    </Dialog>
  );
}
