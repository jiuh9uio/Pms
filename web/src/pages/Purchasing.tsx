import { type QuickPrintDto } from '../../../src/shared/schemas.js';
import { api } from '../api.ts';
import { useAuth } from '../App.tsx';
import { LoadState, PageHeader, useLoad, useTabs } from '../ui.tsx';
import { StockEmpties, StockReceipt } from './Stock.tsx';
import { DeliveryNoteCard } from './DeliveryNote.tsx';

/** Bereich „Einkauf“: Lieferscheine und künftig weitere Werkzeuge rund um Einkauf und Lieferungen. */
export function Purchasing() {
  const { user } = useAuth();
  const isAdmin = user.role === 'admin';
  const { current } = useTabs([['lieferscheine', 'Lieferscheine'], ['warenzugang', 'Warenzugang'], ['leergut', 'Leergut']] as const);
  const { data, error } = useLoad(() => api<QuickPrintDto>('GET', '/quickprint'));
  if (current === 'warenzugang') return <><PageHeader title="Warenzugang" sub="Was ist gekommen? – Ware vom Lieferanten eintragen" /><StockReceipt /></>;
  if (current === 'leergut') return <><PageHeader title="Leergut" sub="Was steht noch bei Kunden, was geht noch an den Lieferanten zurück?" /><StockEmpties /></>;
  return (
    <>
      <PageHeader title="Lieferscheine" sub="Ware ausliefern, z. B. Fassbier zu einer Feier – Lieferschein aus dem Bondrucker" />
      <LoadState error={error} loading={!data} />
      {data && (
        <>
          {data.printerReady
            ? <p className="muted">Gedruckt wird auf: <b>{data.printerName}</b>.</p>
            : <p className="notice warn">Es ist noch kein Bondrucker eingerichtet. {isAdmin ? 'Das geht unter Verwaltung → Einstellungen → Bondrucker vorne.' : 'Das richtet der Administrator ein.'}</p>}
          <DeliveryNoteCard printerReady={data.printerReady} isAdmin={isAdmin} />
        </>
      )}
    </>
  );
}
