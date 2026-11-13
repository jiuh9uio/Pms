import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { rangeLabel, type HygieneOpenDto, type InspectionTypeDto } from '../../../src/shared/controls.js';
import { api } from '../api.ts';
import { useData } from '../data.tsx';
import { Button, Dialog, useLoad, useToast } from '../ui.tsx';

/**
 * Kurzabfrage beim Öffnen der Kontrollen: Für jeden Bereich, in dem heute noch nichts eingetragen ist,
 * genügt ein Tipp auf „Ja“. Gespeichert wird die Bestätigung mit Namen und Uhrzeit, kein Zahlenwert.
 */
export function HygienePrompt() {
  const { rev, bump } = useData();
  const toast = useToast();
  const navigate = useNavigate();
  const { data } = useLoad(() => api<HygieneOpenDto[]>('GET', '/hygiene/open'), [rev]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const open = (data ?? []).filter((a) => !skipped.includes(a.areaId));
  const area = open[0];
  if (!area) return null;

  const yes = async () => {
    setBusy(true);
    try {
      await api('POST', `/hygiene/areas/${area.areaId}/confirm`);
      toast(`${area.areaName}: im Sollbereich bestätigt`);
      bump();
    } catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
    setBusy(false);
  };
  const no = async () => {
    const types = await api<InspectionTypeDto[]>('GET', '/inspection-types');
    const hygiene = types.find((t) => t.kind === 'hygiene' && t.active) ?? types.find((t) => t.kind === 'hygiene');
    setSkipped(open.map((a) => a.areaId));
    if (hygiene) navigate(`/kontrollen/${hygiene.id}?bereich=${area.areaId}`);
  };

  return (
    <Dialog title={`${area.areaName}: alles im Sollwert?`} onClose={() => setSkipped([...skipped, area.areaId])}
      footer={<>
        <Button className="left" onClick={() => setSkipped([...skipped, area.areaId])}>Später</Button>
        <Button onClick={() => void no()}>Nein – Werte eintragen</Button>
        <Button variant="primary" busy={busy} className="big" onClick={() => void yes()} autoFocus>Ja</Button>
      </>}>
      <ul className="plain">
        {area.points.map((p) => <li key={p.id}><b>{p.name}</b><span className="muted">{rangeLabel(p)}</span></li>)}
      </ul>
      {open.length > 1 && <p className="muted small">Danach: {open.slice(1).map((a) => a.areaName).join(', ')}</p>}
    </Dialog>
  );
}
