import { useState } from 'react';
import { Link } from 'react-router-dom';
import { inspectionTypeInput, type InspectionTypeDto } from '../../../src/shared/controls.js';
import { api } from '../api.ts';
import { useAuth } from '../App.tsx';
import { useData } from '../data.tsx';
import { deDate } from '../hotel/common.tsx';
import { Button, Dialog, Field, LoadState, PageHeader, useLoad, useSubmit, useToast } from '../ui.tsx';
import { HygienePrompt } from './HygienePrompt.tsx';
import { Zones } from './Zones.tsx';

/** Auswahl der Kontrollart: Hygieneamt, Finanzamt und alles, was der Betrieb zusätzlich anlegt. */
export function Controls() {
  const { user } = useAuth();
  const { rev } = useData();
  const { data, error } = useLoad(() => api<InspectionTypeDto[]>('GET', '/inspection-types'), [rev]);
  const [add, setAdd] = useState(false);
  const isAdmin = user.role === 'admin';
  return (
    <>
      <PageHeader title="Kontrollen" sub="Kontrollart wählen: Unterlagen bereithalten, Besuche festhalten, Eigenkontrollen führen."
        actions={isAdmin && <Button onClick={() => setAdd(true)}>Kontrollart anlegen</Button>} />
      <LoadState error={error} loading={!data} />
      <div className="tiles">
        {data?.filter((t) => t.active || isAdmin).map((t) => (
          <Link key={t.id} to={`/kontrollen/${t.id}`} className={`tile${t.active ? '' : ' off'}`}>
            <span className="tile-title">{t.name}</span>
            <span className="tile-text">
              {t.itemsTotal > 0 ? `${t.itemsReady} von ${t.itemsTotal} Unterlagen liegen bereit` : 'Noch keine Unterlagen erfasst'}<br />
              {t.lastVisit ? `Letzte Kontrolle: ${deDate(t.lastVisit)}` : 'Noch keine Kontrolle eingetragen'}
              {t.kind === 'hygiene' && <><br />mit Temperaturprotokoll</>}{!t.active && <><br />ausgeblendet</>}
            </span>
          </Link>
        ))}
      </div>
      {isAdmin && data && <Zones types={data} />}
      {add && <TypeDialog type={null} onClose={() => setAdd(false)} />}
      <HygienePrompt />
    </>
  );
}

export function TypeDialog({ type, onClose }: { type: InspectionTypeDto | null; onClose: () => void }) {
  const { bump } = useData();
  const toast = useToast();
  const [v, setV] = useState({ name: type?.name ?? '', active: type?.active ?? true });
  const f = useSubmit(inspectionTypeInput, async (d) => {
    await api(type ? 'PUT' : 'POST', type ? `/inspection-types/${type.id}` : '/inspection-types', type ? { ...d, version: type.version } : d);
    toast('Gespeichert');
    bump();
    onClose();
  });
  return (
    <Dialog title={type ? 'Kontrollart bearbeiten' : 'Kontrollart anlegen'} onClose={onClose}
      footer={<><Button onClick={onClose}>Abbrechen</Button><Button variant="primary" busy={f.busy} onClick={() => void f.submit(v)}>Speichern</Button></>}>
      <form className="formgrid" onSubmit={(e) => void f.submit(v, e)} noValidate>
        <Field label="Bezeichnung" error={f.errors.name} wide hint="z. B. Gewerbeaufsicht, Brandschutz, Zoll, Eichamt">
          <input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} autoFocus />
        </Field>
        {type && <label className="check wide"><input type="checkbox" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} /><span>Anzeigen <small>Ausgeblendete Kontrollarten sieht nur der Administrator.</small></span></label>}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
