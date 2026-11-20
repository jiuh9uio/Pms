import { useState } from 'react';
import { formatMoney } from '../../../src/shared/hotel.js';
import { UNIT_LABEL, groupItems, lineTotal, quantityFor, spanOf, type OfferDto, type OfferItemDto, type OfferTemplateDto, type TalkStep } from '../../../src/shared/offers.js';
import { api } from '../api.ts';
import { CustomerPicker } from '../CustomerPicker.tsx';
import { useData } from '../data.tsx';
import { Button, Dialog, Field, LoadState, useLoad, useToast } from '../ui.tsx';

/**
 * Absprache am Tisch: geführter Ablauf wie bei der Zimmerbuchung – Anlass → allgemeine Daten → eigene Schritte der Vorlage → Übersicht.
 * Die Schritte stellt der Administrator je Vorlage ein (Angebote → Vorlagen → „Absprache am Tisch – Schritte“); ohne eigene Schritte
 * dienen die Gruppen des Produktkatalogs als Schritte. Am Ende: Absprache-Zettel am Angebot + Angebot als Entwurf (nichts wird versendet).
 */
const qty = (s: string) => Number(s.replace(',', '.'));
type Answer = { picked: number[]; text: string };
const EMPTY: Answer = { picked: [], text: '' };

export function OfferWizard({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { bump } = useData();
  const toast = useToast();
  const tplLoad = useLoad(() => api<OfferTemplateDto[]>('GET', '/offer-templates'));
  const allItems = useLoad(() => api<OfferItemDto[]>('GET', '/offer-items')).data ?? [];
  const tpls = (tplLoad.data ?? []).filter((t) => t.active);
  const [tplId, setTplId] = useState<string | null>(null);
  const [v, setV] = useState({ customerCompany: '', customerName: '', phone: '', email: '', eventDate: '', eventEnd: '', persons: '10', wishes: '' });
  const [ans, setAns] = useState<Record<number, Answer>>({});
  /** von Hand geänderte Mengen je Leistung; sonst automatisch aus Personen und Tagen */
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<string | null>(null);

  const tpl = tpls.find((t) => t.id === tplId);
  const itemOf = (id: string | null) => (id ? allItems.find((x) => x.id === id && x.active) : undefined);
  /** Schritte der Vorlage; ohne eigene Schritte: je Gruppe des Produktkatalogs ein Schritt mit Mehrfachauswahl */
  const stepsOf = (t: OfferTemplateDto | undefined): TalkStep[] => {
    if (!t) return [];
    if (t.talkSteps.length) return t.talkSteps;
    const items = t.items.map((c) => itemOf(c.itemId)).filter((x): x is OfferItemDto => !!x);
    return groupItems(items).map((g) => ({ title: g.name, hint: '', kind: 'multi' as const, options: g.items.map((it) => ({ label: it.name, itemId: it.id })) }));
  };
  const steps = stepsOf(tpl);
  const persons = Number(v.persons) || 0;
  const qtyText = (it: OfferItemDto) => qtys[it.id] ?? String(quantityFor(it.unit, persons || 1, v.eventDate || null, v.eventEnd || null)).replace('.', ',');
  const sumOf = (it: OfferItemDto) => { const n = qty(qtyText(it)); return Number.isFinite(n) ? lineTotal(n, it.priceCents) : 0; };
  // gewählte Leistungen (jede nur einmal, in der Reihenfolge der Schritte)
  const chosen: OfferItemDto[] = [];
  steps.forEach((s, i) => (ans[i]?.picked ?? []).forEach((k) => { const it = itemOf(s.options[k]?.itemId ?? null); if (it && !chosen.includes(it)) chosen.push(it); }));
  const total = chosen.reduce((s, it) => s + sumOf(it), 0);
  // Seiten: 0 Anlass, 1 Daten, 2 … Schritte, zuletzt Übersicht
  const names = ['Anlass', 'Daten', ...steps.map((s) => s.title), 'Übersicht'];
  const last = names.length - 1;
  const cur = step >= 2 && step < last ? steps[step - 2] : undefined;
  const ci = step - 2;

  const pickTpl = (t: OfferTemplateDto) => {
    setTplId(t.id); setQtys({});
    // ohne eigene Schritte: „gleich ins Angebot“ aus dem Produktkatalog ist vorausgewählt
    const pre: Record<number, Answer> = {};
    if (!t.talkSteps.length) stepsOf(t).forEach((s, i) => { const picked = s.options.flatMap((o, k) => (t.items.some((c) => c.itemId === o.itemId && c.preselect !== false) ? [k] : [])); if (picked.length) pre[i] = { picked, text: '' }; });
    setAns(pre); setStep(1);
  };
  const dataError = () => (!v.customerName.trim() && !v.customerCompany.trim() ? 'Bitte einen Namen oder eine Firma eintragen.'
    : persons < 1 ? 'Bitte die Personenzahl eintragen.'
    : v.eventEnd && v.eventDate && v.eventEnd < v.eventDate ? 'Das Ende liegt vor dem Beginn.' : null);
  const go = (n: number) => {
    if (n >= 1 && !tpl) { setFail('Bitte zuerst den Anlass wählen.'); setStep(0); return; }
    if (n >= 2) { const e = dataError(); if (e) { setFail(e); setStep(1); return; } }
    setFail(null); setStep(n);
  };
  const toggle = (i: number, k: number, single: boolean) => setAns((a) => {
    const c = a[i] ?? EMPTY, on = c.picked.includes(k);
    return { ...a, [i]: { ...c, picked: single ? (on ? [] : [k]) : on ? c.picked.filter((x) => x !== k) : [...c.picked, k] } };
  });
  const setText = (i: number, text: string) => setAns((a) => ({ ...a, [i]: { ...(a[i] ?? EMPTY), text } }));

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
      await api('PUT', `/offers/${r.id}`, { ...o,
        lines: chosen.map((it) => ({ itemId: it.id, description: it.name, detail: it.description, unit: it.unit, quantity: qty(qtyText(it)), unitPriceCents: it.priceCents, taxRatePercent: it.taxRatePercent })),
        version: o.version });
      await api('POST', `/offers/${r.id}/talk`, { template: tpl?.name ?? '', steps: [
        ...steps.map((s, i) => ({ title: s.title, answers: (ans[i]?.picked ?? []).map((k) => s.options[k]?.label).filter((x): x is string => !!x), text: (ans[i]?.text ?? '').trim() })),
        ...(v.wishes.trim() ? [{ title: 'Wünsche und Absprachen', answers: [], text: v.wishes.trim() }] : []),
      ] });
      toast(`Absprache gespeichert – Angebot ${r.number} als Entwurf angelegt`); bump(); onCreated(r.id);
    } catch (e) {
      const err = e as { message?: string; fields?: Record<string, string> };
      const msg = Object.values(err.fields ?? {}).join(' · ') || err.message || 'Fehler';
      // schon angelegt, aber nicht alles gespeichert → das Angebot öffnen, damit nichts doppelt entsteht
      if (id) { toast(`Angebot angelegt, aber die Absprache wurde nicht vollständig gespeichert: ${msg}`, 'error'); bump(); onCreated(id); }
      else setFail(msg);
    }
    setBusy(false);
  };
  const set = (k: keyof typeof v, x: string) => setV({ ...v, [k]: x });
  const span = spanOf(v.eventDate || null, v.eventEnd || null);
  const dirty = !!tplId || !!v.customerName || !!v.customerCompany;
  const answered = (i: number) => !!(ans[i]?.picked.length || ans[i]?.text.trim());
  return (
    <Dialog title="Absprache – Schritt für Schritt" size="xl" onClose={() => { if (!dirty || window.confirm('Die Eingaben verwerfen?')) onClose(); }}
      footer={<>
        {step >= 2 && total > 0 && <span className="left total">Summe <b>{formatMoney(total)}</b></span>}
        {step > 0 && <Button onClick={() => go(step - 1)}>Zurück</Button>}
        {step > 0 && step < last && <Button variant="primary" onClick={() => go(step + 1)}>Weiter</Button>}
        {step === last && <Button variant="primary" busy={busy} onClick={() => void create()}>Absprache speichern</Button>}
      </>}>
      <ol className="cfg-steps">{names.map((n, i) => {
        const count = i >= 2 && i < last ? (ans[i - 2]?.picked.length ?? 0) : 0;
        const done = i < 2 ? i < step : i < last && answered(i - 2);
        return <li key={`${i}-${n}`}><button type="button" className={i === step ? 'on' : done ? 'done' : ''} onClick={() => go(i)}><span>{i === last ? '✓' : i + 1}</span>{n}{count > 0 && <small>{count}</small>}</button></li>;
      })}</ol>
      {fail && <p className="notice danger" role="alert">{fail}</p>}

      {step === 0 && <>
        <h3 className="first">Worum geht es?</h3>
        <LoadState error={tplLoad.error} loading={!tplLoad.data} />
        <div className="cfg-grid">{tpls.map((t) => (
          <div key={t.id} className={`cfg-card${t.id === tplId ? ' on' : ''}`}>
            <button type="button" className="cfg-pick" onClick={() => pickTpl(t)}>
              <span className="cfg-box" aria-hidden="true">{t.id === tplId ? '✓' : ''}</span>
              <span className="cfg-name">{t.name}<small>{t.talkSteps.length ? `${t.talkSteps.length} Schritte` : t.items.length ? 'Schritte aus dem Produktkatalog' : 'noch keine Schritte hinterlegt'}</small></span>
              <span />
            </button>
          </div>
        ))}</div>
        {tplLoad.data && tpls.length === 0 && <p className="muted">Noch keine Vorlagen angelegt (Angebote → Vorlagen, Administrator).</p>}
      </>}

      {step === 1 && <>
        <h3 className="first">Allgemeine Daten</h3>
        <CustomerPicker label="Schon Kunde? Aus der Kundendatenbank übernehmen" onPick={(c) => setV({ ...v, customerCompany: c.company, customerName: c.name, email: c.email, phone: c.phone })} />
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

      {cur && <>
        <h3 className="first">{cur.title}{cur.kind === 'single' && <small className="muted"> – eine Antwort</small>}{cur.kind === 'multi' && <small className="muted"> – mehrere möglich</small>}</h3>
        <p className="muted small">{cur.hint ? `${cur.hint} · ` : ''}{persons} {persons === 1 ? 'Person' : 'Personen'}{span.days > 1 ? `, ${span.days} Tage` : ''}</p>
        {cur.kind !== 'text' && <div className="tk-choice">{cur.options.map((o, k) => {
          const on = !!ans[ci]?.picked.includes(k), it = itemOf(o.itemId);
          return (
            <div key={k} className={`cfg-card${on ? ' on' : ''}`}>
              <button type="button" className="cfg-pick" aria-pressed={on} onClick={() => toggle(ci, k, cur.kind === 'single')}>
                <span className="cfg-box" aria-hidden="true">{on ? '✓' : ''}</span>
                <span className="cfg-name">{o.label}{it?.description && <small>{it.description}</small>}</span>
                <span className="cfg-price">{it ? <>{formatMoney(it.priceCents)}<small>{UNIT_LABEL[it.unit]}</small></> : null}</span>
              </button>
              {on && it && <div className="cfg-qty"><label>Menge <input inputMode="decimal" className="numinput" value={qtyText(it)} onChange={(e) => setQtys({ ...qtys, [it.id]: e.target.value })} aria-label={`Menge ${o.label}`} /></label><b>{formatMoney(sumOf(it))}</b></div>}
            </div>
          );
        })}</div>}
        {cur.kind !== 'text' && cur.options.length === 0 && <p className="muted">Für diesen Schritt sind noch keine Antworten hinterlegt.</p>}
        <Field label={cur.kind === 'text' ? cur.title : 'Anmerkung dazu (optional)'} wide><textarea rows={cur.kind === 'text' ? 4 : 2} value={ans[ci]?.text ?? ''} onChange={(e) => setText(ci, e.target.value)} /></Field>
      </>}

      {step === last && <>
        <h3 className="first">{tpl?.name} – {[v.customerCompany, v.customerName].filter(Boolean).join(', ')}</h3>
        <p className="muted small">{persons} {persons === 1 ? 'Person' : 'Personen'}{v.eventDate ? ` · ${new Date(`${v.eventDate}T12:00:00`).toLocaleDateString('de-DE')}${v.eventEnd && v.eventEnd !== v.eventDate ? ` bis ${new Date(`${v.eventEnd}T12:00:00`).toLocaleDateString('de-DE')}` : ''}` : ' · Termin noch offen'}{v.phone ? ` · ${v.phone}` : ''}{v.email ? ` · ${v.email}` : ''}</p>
        {steps.length === 0 ? <p className="muted">Für diesen Anlass sind noch keine Schritte hinterlegt (Angebote → Vorlagen).</p> : (
          <div className="tablewrap"><table><tbody>{steps.map((s, i) => (
            <tr key={i} className="rowlink" onClick={() => go(i + 2)}><td><b>{s.title}</b></td><td>{(ans[i]?.picked ?? []).map((k) => s.options[k]?.label).join(', ')}{ans[i]?.text.trim() && <span className="tk-text">{ans[i]!.text.trim()}</span>}{!answered(i) && <span className="muted">– keine Angabe –</span>}</td></tr>
          ))}</tbody></table></div>
        )}
        {chosen.length > 0 && <>
          <h3>Leistungen fürs Angebot</h3>
          <div className="tablewrap"><table><thead><tr><th>Leistung</th><th className="num">Menge</th><th className="num">Einzelpreis</th><th className="num">Gesamt</th></tr></thead>
            <tbody>
              {chosen.map((it) => <tr key={it.id}><td><b>{it.name}</b></td><td className="num">{qtyText(it)}</td><td className="num">{formatMoney(it.priceCents)} <small className="muted">{UNIT_LABEL[it.unit]}</small></td><td className="num">{formatMoney(sumOf(it))}</td></tr>)}
              <tr><td colSpan={3}><b>Summe</b> <small className="muted">inkl. Umsatzsteuer</small></td><td className="num"><b>{formatMoney(total)}</b></td></tr>
            </tbody></table></div>
        </>}
        <Field label="Weitere Wünsche und Absprachen" wide><textarea rows={3} value={v.wishes} onChange={(e) => set('wishes', e.target.value)} placeholder="z. B. Beginn 9 Uhr, Tische in U-Form" /></Field>
        <p className="muted small">„Absprache speichern“ hält alles als Absprache-Zettel fest (zum Nachlesen und Drucken) und legt ein Angebot als <b>Entwurf</b> an{chosen.length ? ' – mit den Leistungen, die einen Preis haben' : ''}. Es wird nichts an den Kunden geschickt.</p>
      </>}
    </Dialog>
  );
}
