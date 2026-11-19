import { PageHeader, useTabs } from '../ui.tsx';
import { StockEmpties, StockReceipt } from './Stock.tsx';

/** Bereich „Einkauf“: Warenzugang und Leergut – künftig weitere Werkzeuge rund um den Einkauf. */
export function Purchasing() {
  const { current } = useTabs([['warenzugang', 'Warenzugang'], ['leergut', 'Leergut']] as const);
  if (current === 'leergut') return <><PageHeader title="Leergut" sub="Leergut an den Lieferanten zurückgeben – mit Bon zum Unterschreiben für den Fahrer" /><StockEmpties /></>;
  return <><PageHeader title="Warenzugang" sub="Was ist gekommen? – Lieferung eintragen und Bon drucken" /><StockReceipt /></>;
}
