import { z } from 'zod';
import { isIsoDate } from './hotel.js';

const text = (max = 200) => z.string().trim().max(max, `Höchstens ${max} Zeichen`);
const required = (max = 200) => text(max).min(1, 'Pflichtfeld');
const isoDate = z.string().refine(isIsoDate, 'Ungültiges Datum');
const version = z.number().int();
const temp = z.number('Bitte eine Zahl eingeben').min(-60, 'Mindestens −60 °C').max(150, 'Höchstens 150 °C');

export const inspectionTypeInput = z.object({ name: required(80), active: z.boolean() });
export const inspectionItemInput = z.object({ text: required(200) });
export const inspectionItemUpdateInput = z.object({ ready: z.boolean(), note: text(300), version });
export const inspectionVisitInput = z.object({ date: isoDate, inspector: text(120), result: text(200), notes: text(2000) });

export const hygieneAreaInput = z.object({ name: required(80), active: z.boolean() });
export const hygienePointInput = z.object({
  areaId: z.uuid('Bitte wählen'), name: required(80), minC: temp.nullable(), maxC: temp.nullable(), active: z.boolean(),
}).refine((v) => v.minC == null || v.maxC == null || v.minC <= v.maxC, { message: 'Höchstwert liegt unter dem Mindestwert', path: ['maxC'] });
export const hygieneReadingsInput = z.object({
  entries: z.array(z.object({ pointId: z.uuid(), date: isoDate, valueC: temp, note: text(300) })).min(1, 'Bitte mindestens einen Wert eintragen').max(200),
});

/** Liegt der Wert außerhalb des Sollbereichs der Messstelle? */
export const outOfRange = (value: number, p: { minC: number | null; maxC: number | null }) =>
  (p.minC != null && value < p.minC) || (p.maxC != null && value > p.maxC);
export const rangeLabel = (p: { minC: number | null; maxC: number | null }) => {
  const f = (n: number) => n.toLocaleString('de-DE');
  if (p.minC != null && p.maxC != null) return `${f(p.minC)} bis ${f(p.maxC)} °C`;
  if (p.maxC != null) return `höchstens ${f(p.maxC)} °C`;
  if (p.minC != null) return `mindestens ${f(p.minC)} °C`;
  return 'kein Sollwert';
};

export interface InspectionTypeDto { id: string; name: string; kind: 'hygiene' | 'generic'; active: boolean; version: number; itemsTotal: number; itemsReady: number; lastVisit: string | null }
export interface InspectionItemDto { id: string; text: string; ready: boolean; note: string; version: number }
export interface InspectionVisitDto { id: string; date: string; inspector: string; result: string; notes: string; recordedBy: string }
export interface InspectionDetailDto { type: InspectionTypeDto; items: InspectionItemDto[]; visits: InspectionVisitDto[] }
export interface HygienePointDto { id: string; areaId: string; name: string; minC: number | null; maxC: number | null; active: boolean; version: number }
export interface HygieneAreaDto { id: string; name: string; active: boolean; version: number; points: HygienePointDto[] }
export interface HygieneReadingDto { pointId: string; date: string; valueC: number; note: string; userName: string; enteredAt: string }
