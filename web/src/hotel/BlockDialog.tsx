import { useState } from 'react';
import { addDays, blockInput, blockUpdateInput, todayBerlin, type RoomDto } from '../../../src/shared/hotel.js';
import { api } from '../api.ts';
import { useData, type BlockPreset } from '../data.tsx';
import { Button, Dialog, Field, useLoad, useSubmit, useToast } from '../ui.tsx';

/** Zimmer sperren (z. B. Reparatur) bzw. eine bestehende Sperre ändern oder aufheben. */
export function BlockDialog({ preset, onClose }: { preset: BlockPreset; onClose: () => void }) {
  const { bump } = useData();
  const toast = useToast();
  const e = preset.entry;
  const rooms = useLoad(() => api<RoomDto[]>('GET', '/rooms'));
  const start = e?.from ?? preset.from ?? todayBerlin();
  const [v, setV] = useState({ roomId: e?.roomId ?? preset.roomId ?? '', from: start, to: e?.to ?? addDays(start, 1), reason: e?.reason ?? '' });
  const [busy, setBusy] = useState(false);
  const done = (msg: string) => { toast(msg); bump(); onClose(); };
  const create = useSubmit(blockInput, async (d) => { await api('POST', '/blocks', d); done('Zimmer gesperrt'); });
  const update = useSubmit(blockUpdateInput, async (d) => { await api('PUT', `/blocks/${e!.blockId}`, d); done('Sperre geändert'); });
  const f = e ? update : create;
  const send = (ev?: React.FormEvent) => void (e ? update.submit({ ...v, version: e.version }, ev) : create.submit(v, ev));
  const remove = async () => {
    setBusy(true);
    try { await api('POST', `/blocks/${e!.blockId}/remove`); done('Sperre aufgehoben – Zimmer ist wieder buchbar'); }
    catch (err) { toast(err instanceof Error ? err.message : 'Fehler', 'error'); setBusy(false); }
  };
  return (
    <Dialog title={e ? 'Sperre bearbeiten' : 'Zimmer sperren'} onClose={onClose}
      footer={<>{e && <Button variant="danger" busy={busy} onClick={() => void remove()} className="left">Sperre aufheben</Button>}
        <Button onClick={onClose}>Abbrechen</Button><Button variant="primary" busy={f.busy} onClick={() => send()}>{e ? 'Speichern' : 'Sperren'}</Button></>}>
      <form className="formgrid" onSubmit={send} noValidate>
        <Field label="Zimmer" error={f.errors.roomId} wide>
          <select value={v.roomId} onChange={(x) => setV({ ...v, roomId: x.target.value })}>
            <option value="">Bitte wählen</option>
            {rooms.data?.filter((r) => r.active || r.id === v.roomId).map((r) => <option key={r.id} value={r.id}>{r.number} – {r.categoryName}</option>)}
          </select>
        </Field>
        <Field label="Gesperrt ab" error={f.errors.from}><input type="date" value={v.from} onChange={(x) => setV({ ...v, from: x.target.value, to: x.target.value >= v.to ? addDays(x.target.value || v.from, 1) : v.to })} /></Field>
        <Field label="Wieder frei ab" error={f.errors.to}><input type="date" value={v.to} onChange={(x) => setV({ ...v, to: x.target.value })} /></Field>
        <Field label="Grund" error={f.errors.reason} wide><input value={v.reason} onChange={(x) => setV({ ...v, reason: x.target.value })} placeholder="z. B. Reparatur Bad" /></Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
