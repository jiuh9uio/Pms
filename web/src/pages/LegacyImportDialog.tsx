import { useState } from 'react';
import { api } from '../api.ts';
import { useData } from '../data.tsx';
import { Button, Dialog, useToast } from '../ui.tsx';

interface Row { kind: 'guest' | 'company'; number: string; salutation?: string; firstName?: string; lastName?: string; name?: string; contactName?: string; street: string; zip: string; city: string; country: string }
interface Result { records: number; guests: number; companies: number; duplicates: number; skipped: { placeholder: number; empty: number }; withoutAddress: number; sample: { guests: Row[]; companies: Row[] }; dryRun: boolean }

/** Kundendatei des alten Programms einlesen: Datei wählen → Vorschau (ändert nichts) → importieren. Die Datei bleibt auf diesem Rechner/Server. */
export function LegacyImportDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const { bump } = useData();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Result | null>(null);
  const [done, setDone] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<string | null>(null);
  const send = async (f: File, dryRun: boolean): Promise<Result> => {
    const res = await fetch(`/api/v1/guests/import-legacy?dryRun=${dryRun ? 1 : 0}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream' }, body: await f.arrayBuffer() });
    const j = await res.json().catch(() => null);
    if (!res.ok) throw new Error(j?.error?.message ?? `Fehler ${res.status}`);
    return j as Result;
  };
  const check = async (f: File) => {
    setFile(f); setPreview(null); setDone(null); setFail(null); setBusy(true);
    try { setPreview(await send(f, true)); } catch (e) { setFail(e instanceof Error ? e.message : 'Fehler'); }
    setBusy(false);
  };
  const run = async () => {
    if (!file) return;
    setBusy(true); setFail(null);
    try { const r = await send(file, false); setDone(r); setPreview(null); toast(`${r.guests} Gäste und ${r.companies} Firmen importiert`); bump(); }
    catch (e) { setFail(e instanceof Error ? e.message : 'Fehler'); }
    setBusy(false);
  };
  const r = done ?? preview;
  return (
    <Dialog title="Kunden aus dem alten Programm importieren" onClose={onClose} size="lg"
      footer={<>{preview && !done && <Button variant="primary" busy={busy} disabled={preview.guests + preview.companies === 0} onClick={() => void run()}>Jetzt importieren</Button>}<Button onClick={onClose}>{done ? 'Fertig' : 'Abbrechen'}</Button></>}>
      <p className="muted">Die Datei <b>Kunden.dat</b> des alten Programms auswählen. Zuerst zeigt das Programm nur an, was übernommen würde – erst mit „Jetzt importieren“ wird etwas angelegt. Bereits vorhandene Gäste (gleicher Name und PLZ) und Firmen werden übersprungen, ein zweiter Durchlauf legt also nichts doppelt an.</p>
      <label className="btn">Datei wählen …<input type="file" accept=".dat" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void check(f); e.target.value = ''; }} /></label>
      {file && <span className="muted small"> {file.name} · {Math.round(file.size / 1024)} kB</span>}
      {busy && !r && <p className="notice">Datei wird gelesen …</p>}
      {fail && <p className="notice danger" role="alert">{fail}</p>}
      {r && (
        <div className={`notice${done ? '' : ' warn'}`} style={{ marginTop: 12 }}>
          <b>{done ? 'Importiert:' : 'Das würde übernommen:'}</b>
          <ul>
            <li><b>{r.guests}</b> Gäste und <b>{r.companies}</b> Firmen (aus {r.records} Datensätzen)</li>
            {r.duplicates > 0 && <li>{r.duplicates} schon vorhanden – werden übersprungen</li>}
            {r.skipped.placeholder + r.skipped.empty > 0 && <li>{r.skipped.placeholder + r.skipped.empty} Platzhalter oder leere Datensätze – werden übersprungen</li>}
            {r.withoutAddress > 0 && <li>{r.withoutAddress} ohne Anschrift</li>}
          </ul>
          {done && <p className="small">Jeder übernommene Eintrag trägt in den Bemerkungen die alte Kundennummer. Mögliche Doppelte lassen sich unter Gäste → „Mögliche Doppelte“ zusammenführen.</p>}
        </div>
      )}
      {preview && preview.sample.guests.length > 0 && (
        <>
          <h3>Beispiele Gäste</h3>
          <div className="tablewrap"><table className="lines"><thead><tr><th>Anrede</th><th>Vorname</th><th>Nachname</th><th>Anschrift</th></tr></thead>
            <tbody>{preview.sample.guests.map((g) => <tr key={g.number}><td>{g.salutation}</td><td>{g.firstName}</td><td>{g.lastName}</td><td>{[g.street, [g.zip, g.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')}</td></tr>)}</tbody></table></div>
        </>
      )}
      {preview && preview.sample.companies.length > 0 && (
        <>
          <h3>Beispiele Firmen</h3>
          <div className="tablewrap"><table className="lines"><thead><tr><th>Firma</th><th>Ansprechpartner</th><th>Anschrift</th></tr></thead>
            <tbody>{preview.sample.companies.map((c) => <tr key={c.number}><td>{c.name}</td><td>{c.contactName}</td><td>{[c.street, [c.zip, c.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')}</td></tr>)}</tbody></table></div>
        </>
      )}
      <p className="muted small">Übernommen werden Name, Anrede, Straße, PLZ, Ort, Telefon und E-Mail (soweit vorhanden). Nicht übernommen: das Bemerkungsfeld (enthält nur einen Mustertext des alten Programms) und zwei Datumsfelder unbekannter Bedeutung. Namen werden so aufgeteilt: „Herr/Frau Vorname Nachname“ und „Vorname Nachname“ → letztes Wort = Nachname; „Nachname, Vorname“ → vor dem Komma. Firmen erkennt das Programm an Rechtsform oder Stichwort (GmbH, Hotel, Verein …) oder an einem Ansprechpartner „Herr/Frau …“.</p>
    </Dialog>
  );
}
