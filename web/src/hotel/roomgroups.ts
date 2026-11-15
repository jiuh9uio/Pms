import type { CategoryDto, RoomDto } from '../../../src/shared/hotel.js';

/**
 * Zimmer nach Etage ordnen. Die Etage kommt aus den Zimmerdaten (Feld „Etage“); ist sie leer, gilt die übliche
 * Hotelzählung: bei dreistelligen Nummern die erste Ziffer (101 → 1. Etage, 201 → 2. Etage).
 */
export function floorOf(r: Pick<RoomDto, 'floor' | 'number'>): string {
  const f = r.floor.trim();
  if (f) return f;
  const m = /^(\d)\d{2}$/.exec(r.number.trim());
  return m ? m[1]! : '';
}
export function floorLabel(f: string): string {
  if (!f) return 'Ohne Etage';
  if (/^(0|eg|erdgeschoss)$/i.test(f)) return 'Erdgeschoss';
  if (/^\d+$/.test(f)) return `${f}. Etage`;
  if (/^\d+\.?\s*(og|etage|stock)$/i.test(f)) return `${parseInt(f, 10)}. Etage`;
  if (/^(dg|dachgeschoss)$/i.test(f)) return 'Dachgeschoss';
  if (/^(ug|kg|keller|untergeschoss)$/i.test(f)) return 'Untergeschoss';
  return f;
}
const floorRank = (f: string) => {
  if (/^(ug|kg|keller|untergeschoss)$/i.test(f)) return -1;
  if (/^(0|eg|erdgeschoss)$/i.test(f)) return 0;
  const n = parseInt(f, 10);
  if (!Number.isNaN(n)) return n;
  if (/^(dg|dachgeschoss)$/i.test(f)) return 900;
  return f ? 950 : 999;
};
export function groupByFloor<T extends Pick<RoomDto, 'floor' | 'number'>>(rooms: T[]): { floor: string; label: string; rooms: T[] }[] {
  const map = new Map<string, T[]>();
  for (const r of rooms) { const f = floorOf(r); map.set(f, [...(map.get(f) ?? []), r]); }
  return [...map.entries()].sort(([a], [b]) => floorRank(a) - floorRank(b) || a.localeCompare(b, 'de'))
    .map(([floor, list]) => ({ floor, label: floorLabel(floor), rooms: list.sort((a, b) => a.number.localeCompare(b.number, 'de', { numeric: true })) }));
}

/** Feste Farbe je Zimmerkategorie (Reihenfolge der Kategorien), damit z. B. Einzel- und Doppelzimmer sofort unterscheidbar sind. */
export const CAT_COLORS = 6;
export function catColorIndex(cats: Pick<CategoryDto, 'id' | 'sort' | 'name'>[] | undefined, categoryId: string): number {
  if (!cats) return 0;
  const sorted = [...cats].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'de'));
  const i = sorted.findIndex((c) => c.id === categoryId);
  return i < 0 ? 0 : i % CAT_COLORS;
}
