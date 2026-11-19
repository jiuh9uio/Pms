import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import {
  DEFAULT_PALETTE, PAGE_H, PAGE_W, PLACEHOLDERS, fillText, layoutTemplate,
  type DesignElement, type VoucherDesignDetailDto, type VoucherLayout,
} from '../../../src/shared/vouchers.js';
import { api } from '../api.ts';
import { Button, Dialog, Field, LoadState, useLoad, useToast } from '../ui.tsx';

const SAMPLE = Object.fromEntries(PLACEHOLDERS.map((p) => [p.key, p.sample]));
const PT_PER_MM = 72 / 25.4;
const FONT = { serif: '"Liberation Serif", "Times New Roman", Times, serif', sans: '"Liberation Sans", Arial, Helvetica, sans-serif' };
const round = (n: number) => Math.round(n * 2) / 2;
let nextId = Date.now() % 100000;
const newId = () => `n${++nextId}`;
const BLANK: Omit<DesignElement, 'type' | 'label' | 'x' | 'y' | 'w' | 'h'> = {
  id: '', hidden: false, text: '', font: 'serif', size: 12, bold: false, italic: false, align: 'left', color: '#1f1f24', fill: '#ffffff', opacity: 1, radius: 0, border: '',
};
type Img = { mime: 'image/png' | 'image/jpeg'; dataBase64: string; url: string };

/**
 * Design-Editor für Gutscheine: Vorschau in Originalproportion (DIN A5 quer), Elemente mit Maus oder Finger verschieben
 * und an der Ecke in der Größe ändern; rechts Schrift, Größe, Farbe aus der Palette, Ausrichtung, Ebenen.
 * Die Vorschau ist eine Annäherung – maßgeblich ist das PDF („Speichern & Druckvorschau“).
 */
export function VoucherDesignEditor({ designId, initial, onClose, onSaved }: { designId: string | null; initial?: { name: string; layout: VoucherLayout }; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const existing = useLoad(async () => (designId ? api<VoucherDesignDetailDto>('GET', `/voucher-designs/${designId}`) : null), [designId]);
  const logo = useLoad(() => api<{ present: boolean }>('GET', '/settings/logo-info').catch(() => ({ present: false })));
  const [name, setName] = useState('');
  const [layout, setLayout] = useState<VoucherLayout | null>(null);
  const [image, setImage] = useState<Img | null | undefined>(undefined); // undefined = unverändert
  const [sel, setSel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Startzustand: gespeicherte Gestaltung, sonst Vorlage (bei alten Motiven passend zur Textfeld-Lage)
  useEffect(() => {
    if (designId && !existing.data) return;
    const d = existing.data;
    setName(d?.name ?? initial?.name ?? 'Neues Design');
    setLayout(d?.layout ?? (initial ? structuredClone(initial.layout) : layoutTemplate(d ? (d.textPos === 'bottom' ? 'bottom' : 'right') : 'classic')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [designId, existing.data]);

  const hasImage = image === undefined ? !!existing.data?.hasImage : !!image;
  const imageUrl = image ? image.url : image === undefined && existing.data?.hasImage ? `/api/v1/voucher-designs/${designId}/image` : null;
  if (!layout) return <Dialog title="Design-Editor" onClose={onClose} size="xl"><LoadState error={existing.error} loading /></Dialog>;

  const change = (next: VoucherLayout) => { setLayout(next); setDirty(true); };
  const upd = (id: string, patch: Partial<DesignElement>) => change({ ...layout, elements: layout.elements.map((e) => (e.id === id ? { ...e, ...patch } : e)) });
  const selected = layout.elements.find((e) => e.id === sel) ?? null;
  const add = (type: DesignElement['type']) => {
    const base = { ...BLANK, id: newId(), type };
    const e: DesignElement = type === 'text' ? { ...base, label: 'Text', x: 60, y: 60, w: 90, h: 10, text: 'Ihr Text', size: 14, align: 'center' }
      : type === 'box' ? { ...base, label: 'Fläche', x: 50, y: 40, w: 110, h: 60, fill: '#ffffff', opacity: 0.85, radius: 3 }
      : type === 'logo' ? { ...base, label: 'Logo', x: 85, y: 10, w: 40, h: 16, align: 'center' }
      : { ...base, label: 'Strichcode', x: 80, y: 100, w: 50, h: 12 };
    change({ ...layout, elements: [...layout.elements, e] });
    setSel(e.id);
  };
  const move = (id: string, dir: -1 | 1) => {
    const i = layout.elements.findIndex((e) => e.id === id), j = i + dir;
    if (i < 0 || j < 0 || j >= layout.elements.length) return;
    const els = [...layout.elements]; [els[i], els[j]] = [els[j]!, els[i]!];
    change({ ...layout, elements: els });
  };
  const remove = (id: string) => { change({ ...layout, elements: layout.elements.filter((e) => e.id !== id) }); setSel(null); };
  const duplicate = (e: DesignElement) => { const c = { ...e, id: newId(), x: e.x + 5, y: e.y + 5, label: `${e.label} (Kopie)` }; change({ ...layout, elements: [...layout.elements, c] }); setSel(c.id); };
  const template = (k: 'classic' | 'right' | 'bottom') => {
    if (dirty && !window.confirm('Vorlage übernehmen? Die bisherige Anordnung wird ersetzt (Hintergrundbild und Palette bleiben).')) return;
    const t = layoutTemplate(k);
    change({ ...t, background: layout.background, useImage: layout.useImage, imageFit: layout.imageFit, palette: layout.palette.length ? layout.palette : t.palette });
    setSel(null);
  };
  const pickImage = (file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(png|jpeg)$/.test(file.type)) { toast('Bitte ein PNG- oder JPG-Bild wählen', 'error'); return; }
    if (file.size > 5 * 1024 * 1024) { toast('Das Bild ist zu groß (höchstens 5 MB)', 'error'); return; }
    const r = new FileReader();
    r.onload = () => { const url = String(r.result); setImage({ mime: file.type as Img['mime'], dataBase64: url.split(',')[1]!, url }); change({ ...layout, useImage: true }); };
    r.readAsDataURL(file);
  };
  const save = async (preview: boolean) => {
    setBusy(true);
    // Vorschau-Fenster sofort öffnen (sonst blockiert der Browser das Fenster nach dem Speichern)
    const win = preview ? window.open('', '_blank') : null;
    try {
      const body = { name: name.trim() || 'Design', layout, ...(image === undefined ? {} : { image: image ? { mime: image.mime, dataBase64: image.dataBase64 } : null }) };
      const r = await api<{ id: string }>(designId ? 'PUT' : 'POST', designId ? `/voucher-designs/${designId}/editor` : '/voucher-designs/editor', body);
      toast('Design gespeichert'); setDirty(false); onSaved();
      if (win) win.location.href = `/api/v1/voucher-designs/${r.id}/preview`;
      if (!designId) onClose();
    } catch (e) { win?.close(); toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
    setBusy(false);
  };
  const close = () => { if (!dirty || window.confirm('Änderungen verwerfen?')) onClose(); };
  const palette = layout.palette.length ? layout.palette : DEFAULT_PALETTE;

  return (
    <Dialog title="Design-Editor" onClose={close} size="xl"
      footer={<><span className="left muted small">Vorschau ungefähr – maßgeblich ist das PDF. Platzhalter wie {'{wert}'} werden beim Drucken ersetzt.</span>
        <Button onClick={close}>Abbrechen</Button>
        <Button busy={busy} onClick={() => void save(true)}>Speichern &amp; Druckvorschau</Button>
        <Button variant="primary" busy={busy} onClick={() => void save(false)}>Speichern</Button></>}>
      <div className="vde-top">
        <Field label="Name des Designs"><input value={name} onChange={(e) => { setName(e.target.value); setDirty(true); }} /></Field>
        <div className="vde-tools">
          <span className="muted small">Vorlage:</span>
          <Button onClick={() => template('classic')}>Klassisch</Button><Button onClick={() => template('right')}>Text rechts</Button><Button onClick={() => template('bottom')}>Text unten</Button>
          <span className="muted small">Einfügen:</span>
          <Button onClick={() => add('text')}>+ Text</Button><Button onClick={() => add('box')}>+ Fläche</Button>
          <Button onClick={() => add('logo')} title={logo.data?.present ? undefined : 'Noch kein Logo hinterlegt (Verwaltung → Einstellungen → Rechnungslayout)'}>+ Logo</Button>
          <Button onClick={() => add('barcode')}>+ Strichcode</Button>
        </div>
      </div>
      {!logo.data?.present && layout.elements.some((e) => e.type === 'logo' && !e.hidden) && <p className="notice warn small">Es ist noch kein Logo hinterlegt – das Logo-Feld bleibt beim Drucken leer. Hochladen unter Verwaltung → Einstellungen → Rechnungslayout.</p>}
      <div className="vde">
        <Canvas layout={layout} imageUrl={layout.useImage ? imageUrl : null} sel={sel} onSelect={setSel} onChange={upd} logo={!!logo.data?.present} />
        <aside className="vde-side">
          {selected ? (
            <ElementPanel e={selected} palette={palette} onChange={(p) => upd(selected.id, p)} onAddColor={(c) => change({ ...layout, palette: palette.includes(c) ? palette : [...palette, c].slice(-24) })}
              onFront={() => move(selected.id, 1)} onBack={() => move(selected.id, -1)} onDuplicate={() => duplicate(selected)} onRemove={() => remove(selected.id)} onDone={() => setSel(null)} />
          ) : (
            <>
              <h3 className="first">Hintergrund</h3>
              <ColorPick label="Hintergrundfarbe" value={layout.background} palette={palette} onChange={(c) => change({ ...layout, background: c })} />
              <div className="vde-row">
                <label className="btn vde-upload">{hasImage ? 'Anderes Bild …' : 'Bild hochladen …'}<input type="file" accept="image/png,image/jpeg" hidden onChange={(e) => { pickImage(e.target.files?.[0]); e.target.value = ''; }} /></label>
                {hasImage && <Button onClick={() => { setImage(null); setDirty(true); }}>Bild entfernen</Button>}
              </div>
              {hasImage && <>
                <label className="check"><input type="checkbox" checked={layout.useImage} onChange={(e) => change({ ...layout, useImage: e.target.checked })} /><span>Bild anzeigen</span></label>
                <Field label="Bild"><select value={layout.imageFit} onChange={(e) => change({ ...layout, imageFit: e.target.value as 'cover' | 'contain' })}><option value="cover">füllt die Seite (Ränder werden abgeschnitten)</option><option value="contain">ganz sichtbar (Ränder in Hintergrundfarbe)</option></select></Field>
              </>}
              <h3>Farbpalette</h3>
              <div className="vde-swatches">
                {palette.map((c) => <span key={c} className="vde-swatch" style={{ background: c }} title={c}><button type="button" aria-label={`Farbe ${c} entfernen`} onClick={() => change({ ...layout, palette: palette.filter((x) => x !== c) })}>×</button></span>)}
                <label className="vde-swatch vde-addcolor" title="Farbe hinzufügen"><input type="color" onChange={(e) => change({ ...layout, palette: [...new Set([...palette, e.target.value])].slice(-24) })} />+</label>
              </div>
              <h3>Elemente <small className="muted inl">antippen zum Bearbeiten</small></h3>
              <ul className="vde-layers">
                {[...layout.elements].reverse().map((e) => (
                  <li key={e.id}><button type="button" className={e.hidden ? 'off' : ''} onClick={() => setSel(e.id)}>{e.label || e.type}{e.hidden && ' (ausgeblendet)'}</button></li>
                ))}
              </ul>
              <p className="muted small">Tipp: Element antippen und ziehen; an der Ecke unten rechts die Größe ändern. Mit den Pfeiltasten um 1 mm verschieben (mit Umschalt 5 mm).</p>
            </>
          )}
        </aside>
      </div>
    </Dialog>
  );
}

/** Nur ansehen (z. B. Vorlagen-Galerie) */
export function LayoutPreview({ layout, logo }: { layout: VoucherLayout; logo: boolean }) {
  return <Canvas layout={layout} imageUrl={null} sel={null} onSelect={() => {}} onChange={() => {}} logo={logo} readOnly />;
}

function Canvas({ layout, imageUrl, sel, onSelect, onChange, logo, readOnly }: {
  layout: VoucherLayout; imageUrl: string | null; sel: string | null; onSelect: (id: string | null) => void; onChange: (id: string, p: Partial<DesignElement>) => void; logo: boolean; readOnly?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [cw, setCw] = useState(600);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(() => setCw(el.clientWidth));
    ro.observe(el); setCw(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const k = cw / PAGE_W; // px je mm
  const drag = useRef<{ id: string; mode: 'move' | 'size'; sx: number; sy: number; e: DesignElement } | null>(null);
  const down = (ev: RPointerEvent, e: DesignElement, mode: 'move' | 'size') => {
    if (readOnly) return;
    ev.stopPropagation(); ev.preventDefault();
    onSelect(e.id);
    (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
    drag.current = { id: e.id, mode, sx: ev.clientX, sy: ev.clientY, e };
  };
  const moveP = (ev: RPointerEvent) => {
    const d = drag.current; if (!d) return;
    const dx = (ev.clientX - d.sx) / k, dy = (ev.clientY - d.sy) / k;
    if (d.mode === 'move') onChange(d.id, { x: round(d.e.x + dx), y: round(d.e.y + dy) });
    else onChange(d.id, { w: Math.max(4, round(d.e.w + dx)), h: Math.max(3, round(d.e.h + dy)) });
  };
  const up = () => { drag.current = null; };
  const key = (ev: React.KeyboardEvent) => {
    const e = layout.elements.find((x) => x.id === sel); if (!e) return;
    const s = ev.shiftKey ? 5 : 1;
    const m: Record<string, Partial<DesignElement>> = { ArrowLeft: { x: e.x - s }, ArrowRight: { x: e.x + s }, ArrowUp: { y: e.y - s }, ArrowDown: { y: e.y + s } };
    if (m[ev.key]) { ev.preventDefault(); onChange(e.id, m[ev.key]!); }
  };
  return (
    <div className={readOnly ? 'vde-stage ro' : 'vde-stage'}>
      <div ref={ref} className="vde-page" tabIndex={0} onKeyDown={key} onPointerDown={() => onSelect(null)} onPointerMove={moveP} onPointerUp={up}
        style={{ background: layout.background, aspectRatio: `${PAGE_W} / ${PAGE_H}` }}>
        {imageUrl && <img className="vde-bg" src={imageUrl} alt="" style={{ objectFit: layout.imageFit }} draggable={false} />}
        {layout.elements.map((e) => {
          if (e.hidden) return null;
          const style: React.CSSProperties = { left: e.x * k, top: e.y * k, width: e.w * k, height: e.h * k };
          let inner: React.ReactNode = null;
          if (e.type === 'box') Object.assign(style, { background: hexA(e.fill, e.opacity), border: e.border ? `1px solid ${e.border}` : undefined, borderRadius: e.radius * k });
          else if (e.type === 'logo') inner = logo ? <img src="/api/v1/settings/logo" alt="Logo" draggable={false} style={{ objectPosition: e.align }} /> : <span className="vde-ph">Logo</span>;
          else if (e.type === 'barcode') inner = <span className="vde-barcode" />;
          else {
            const pt = k / PT_PER_MM; // px je pt
            inner = <span style={{ fontFamily: FONT[e.font], fontSize: e.size * pt, fontWeight: e.bold ? 700 : 400, fontStyle: e.italic ? 'italic' : 'normal', color: e.color, textAlign: e.align, lineHeight: 1.22 }}>{fillText(e.text, SAMPLE)}</span>;
          }
          return (
            <div key={e.id} className={`vde-el vde-${e.type}${sel === e.id ? ' on' : ''}`} style={style} onPointerDown={(ev) => down(ev, e, 'move')}>
              {inner}
              {sel === e.id && <i className="vde-handle" onPointerDown={(ev) => down(ev, e, 'size')} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
const hexA = (h: string, a: number) => `rgba(${parseInt(h.slice(1, 3), 16)}, ${parseInt(h.slice(3, 5), 16)}, ${parseInt(h.slice(5, 7), 16)}, ${a})`;

function ColorPick({ label, value, palette, onChange, onAdd }: { label: string; value: string; palette: string[]; onChange: (c: string) => void; onAdd?: (c: string) => void }) {
  return (
    <div className="field">
      <span className="label">{label}</span>
      <div className="vde-swatches">
        {palette.map((c) => <button type="button" key={c} className={`vde-swatch${c.toLowerCase() === value.toLowerCase() ? ' on' : ''}`} style={{ background: c }} title={c} aria-label={`Farbe ${c}`} onClick={() => onChange(c)} />)}
        <label className="vde-swatch vde-addcolor" title="eigene Farbe"><input type="color" value={value} onChange={(e) => onChange(e.target.value)} />…</label>
      </div>
      {onAdd && !palette.includes(value) && <button type="button" className="linkbtn" onClick={() => onAdd(value)}>Farbe {value} zur Palette</button>}
    </div>
  );
}

function ElementPanel({ e, palette, onChange, onAddColor, onFront, onBack, onDuplicate, onRemove, onDone }: {
  e: DesignElement; palette: string[]; onChange: (p: Partial<DesignElement>) => void; onAddColor: (c: string) => void;
  onFront: () => void; onBack: () => void; onDuplicate: () => void; onRemove: () => void; onDone: () => void;
}) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const insert = (k: string) => {
    const t = ta.current; const token = `{${k}}`;
    if (!t) { onChange({ text: e.text + token }); return; }
    const s = t.selectionStart ?? e.text.length, en = t.selectionEnd ?? s;
    onChange({ text: e.text.slice(0, s) + token + e.text.slice(en) });
  };
  const num = (k: 'x' | 'y' | 'w' | 'h', label: string) => <label className="vde-num"><small>{label}</small><input type="number" step={0.5} value={e[k]} onChange={(ev) => onChange({ [k]: Number(ev.target.value) || 0 })} /></label>;
  return (
    <>
      <div className="vde-panelhead"><h3 className="first">{e.type === 'text' ? 'Text' : e.type === 'box' ? 'Fläche' : e.type === 'logo' ? 'Logo' : 'Strichcode'}</h3><button type="button" className="linkbtn" onClick={onDone}>← Übersicht</button></div>
      <Field label="Bezeichnung"><input value={e.label} onChange={(ev) => onChange({ label: ev.target.value })} /></Field>
      {e.type === 'text' && (
        <>
          <Field label="Text" hint="Platzhalter werden beim Drucken mit den Angaben des Gutscheins gefüllt"><textarea ref={ta} rows={4} value={e.text} onChange={(ev) => onChange({ text: ev.target.value })} /></Field>
          <div className="vde-chips">{PLACEHOLDERS.map((p) => <button type="button" key={p.key} className="chip" title={`Beispiel: ${p.sample}`} onClick={() => insert(p.key)}>{p.label}</button>)}</div>
          <div className="vde-row">
            <Field label="Schrift"><select value={e.font} onChange={(ev) => onChange({ font: ev.target.value as 'serif' | 'sans' })}><option value="serif">mit Serifen (klassisch)</option><option value="sans">ohne Serifen (modern)</option></select></Field>
            <Field label="Größe (pt)"><input type="number" min={5} max={96} step={0.5} value={e.size} onChange={(ev) => onChange({ size: Math.min(96, Math.max(5, Number(ev.target.value) || 12)) })} /></Field>
          </div>
          <div className="vde-row vde-toggles">
            <button type="button" className={`chip${e.bold ? ' on' : ''}`} aria-pressed={e.bold} onClick={() => onChange({ bold: !e.bold })}><b>F</b> fett</button>
            <button type="button" className={`chip${e.italic ? ' on' : ''}`} aria-pressed={e.italic} onClick={() => onChange({ italic: !e.italic })}><i>K</i> kursiv</button>
            {(['left', 'center', 'right'] as const).map((a) => <button type="button" key={a} className={`chip${e.align === a ? ' on' : ''}`} aria-pressed={e.align === a} onClick={() => onChange({ align: a })}>{{ left: 'links', center: 'Mitte', right: 'rechts' }[a]}</button>)}
          </div>
          <ColorPick label="Schriftfarbe" value={e.color} palette={palette} onChange={(c) => onChange({ color: c })} onAdd={onAddColor} />
        </>
      )}
      {e.type === 'box' && (
        <>
          <ColorPick label="Füllfarbe" value={e.fill} palette={palette} onChange={(c) => onChange({ fill: c })} onAdd={onAddColor} />
          <Field label={`Deckkraft ${Math.round(e.opacity * 100)} %`}><input type="range" min={0} max={1} step={0.05} value={e.opacity} onChange={(ev) => onChange({ opacity: Number(ev.target.value) })} /></Field>
          <label className="check"><input type="checkbox" checked={!!e.border} onChange={(ev) => onChange({ border: ev.target.checked ? '#1f1f24' : '' })} /><span>Rahmenlinie</span></label>
          {e.border && <ColorPick label="Rahmenfarbe" value={e.border} palette={palette} onChange={(c) => onChange({ border: c })} onAdd={onAddColor} />}
          <Field label="Ecken abrunden (mm)" hint="halbe Breite = Kreis"><input type="number" min={0} max={120} value={e.radius} onChange={(ev) => onChange({ radius: Number(ev.target.value) || 0 })} /></Field>
        </>
      )}
      {e.type === 'logo' && (
        <div className="vde-row vde-toggles">{(['left', 'center', 'right'] as const).map((a) => <button type="button" key={a} className={`chip${e.align === a ? ' on' : ''}`} onClick={() => onChange({ align: a })}>{{ left: 'links', center: 'Mitte', right: 'rechts' }[a]}</button>)}</div>
      )}
      {e.type === 'barcode' && <p className="muted small">Zeigt die Kassennummer als Strichcode (Code 128). Ohne Kassennummer bleibt das Feld leer. Für sicheres Scannen mindestens etwa 40 mm breit lassen.</p>}
      <h3>Lage und Größe (mm)</h3>
      <div className="vde-row vde-nums">{num('x', 'links')}{num('y', 'oben')}{num('w', 'Breite')}{num('h', 'Höhe')}</div>
      <div className="vde-row">
        <Button onClick={onFront}>Nach vorn</Button><Button onClick={onBack}>Nach hinten</Button>
        <Button onClick={() => onChange({ hidden: !e.hidden })}>{e.hidden ? 'Einblenden' : 'Ausblenden'}</Button>
        <Button onClick={onDuplicate}>Duplizieren</Button>
        <Button variant="danger" onClick={onRemove}>Löschen</Button>
      </div>
    </>
  );
}
