import type { ReactNode } from 'react';
import { ROOM_PLAN_STATUS_LABEL, type Corridor, type FloorPlan, type RoomPlanStatus } from '../../../src/shared/floorplan.js';
import { floorLabel } from './roomgroups.ts';

/** Was der Plan je Zimmer braucht – aus dem Etagenplan-Status oder (bei der Zimmerwahl) aus der Verfügbarkeit. */
export interface PlanTile { id: string; number: string; category: string; floor: string; status: RoomPlanStatus; title: string; sub?: string }

const Window = () => (
  <svg className="fp-window" viewBox="0 0 22 12" aria-hidden><rect x="1" y="1" width="20" height="10" rx="2" /><path d="M11 1v10M1 6h20" /></svg>
);
const Stairs = () => (
  <svg className="fp-stairs-icon" viewBox="0 0 32 32" aria-hidden><path d="M4 28h6v-6h6v-6h6v-6h6V4" /></svg>
);

/**
 * Schematischer Grundriss: je Flur oben die Straßenseite (Fenster), in der Mitte der Gang, unten die Hofseite.
 * Gleicher Platz oben und unten = gegenüber. Zimmer sind anklickbar; die Farbe zeigt den Status.
 */
export function FloorPlanView({ plan, tiles, onRoom, selected, legend = true }: {
  plan: FloorPlan; tiles: PlanTile[]; onRoom: (t: PlanTile) => void; selected?: Set<string>; legend?: boolean;
}) {
  const byNumber = new Map(tiles.map((t) => [t.number, t]));
  const placed = new Set<string>();
  for (const c of plan.corridors) for (const n of [...c.street, ...c.court]) if (byNumber.has(n)) placed.add(n);
  const tile = (n: string, side: 'street' | 'court', key: string): ReactNode => {
    if (n === '-' || n === '') return <div key={key} className="fp-slot fp-empty" />;
    const t = byNumber.get(n);
    if (!t) return <div key={key} className="fp-slot fp-missing" title={`Zimmer ${n} ist im Programm nicht angelegt`}><b>{n}</b><small>nicht angelegt</small></div>;
    const on = selected?.has(t.id);
    return (
      <button key={key} type="button" className={`fp-slot fp-room st-${t.status}${on ? ' on' : ''}`} onClick={() => onRoom(t)}
        title={`Zimmer ${t.number} · ${t.category} · ${ROOM_PLAN_STATUS_LABEL[t.status]}${t.title ? ` · ${t.title}` : ''}`} aria-pressed={selected ? !!on : undefined}>
        {side === 'street' && <Window />}
        <b>{t.number}</b>
        <small>{t.sub ?? t.category}</small>
        {on && <i className="fp-check" aria-hidden>✓</i>}
      </button>
    );
  };
  const corridorView = (c: Corridor) => {
    const cols = Math.max(c.street.length, c.court.length, 1);
    const hasStreet = c.street.some((n) => n !== '-'), hasCourt = c.court.some((n) => n !== '-');
    // Reihen: Straßenseite, Gang, Hofseite – leere Seiten entfallen
    const rowsDef = [hasStreet ? 'street' : null, 'hall', hasCourt ? 'court' : null].filter(Boolean) as ('street' | 'hall' | 'court')[];
    const rowOf = (r: 'street' | 'hall' | 'court') => rowsDef.indexOf(r) + 1;
    const offset = c.stairs === 'start' ? 1 : 0;
    const totalCols = cols + (c.stairs === 'none' ? 0 : 1);
    const stairsCol = c.stairs === 'none' ? null : <div className="fp-stairs" style={{ gridRow: `1 / span ${rowsDef.length}`, gridColumn: c.stairs === 'start' ? 1 : cols + 1 }} title="Treppenhaus"><Stairs /><small>Treppe</small></div>;
    return (
      <section key={c.id} className="fp-corridor">
        <header className="fp-head"><b>{c.name || 'Flur'}</b>{c.floor && <span>{floorLabel(c.floor)}</span>}</header>
        <div className="fp-side fp-side-street">Straßenseite · Fenster</div>
        <div className="fp-grid" style={{ gridTemplateColumns: `repeat(${totalCols}, minmax(54px, 112px))`, gridTemplateRows: rowsDef.map((r) => (r === 'hall' ? '30px' : 'auto')).join(' ') }}>
          {stairsCol}
          {hasStreet && Array.from({ length: cols }, (_, i) => <div key={`s${i}`} className="fp-cell" style={{ gridRow: rowOf('street'), gridColumn: i + 1 + offset }}>{tile(c.street[i] ?? '-', 'street', `s${i}`)}</div>)}
          <div className="fp-hall" style={{ gridRow: rowOf('hall'), gridColumn: `${1 + offset} / span ${cols}` }}><span>Gang</span></div>
          {hasCourt && Array.from({ length: cols }, (_, i) => <div key={`c${i}`} className="fp-cell" style={{ gridRow: rowOf('court'), gridColumn: i + 1 + offset }}>{tile(c.court[i] ?? '-', 'court', `c${i}`)}</div>)}
        </div>
        <div className="fp-side fp-side-court">Hofseite{hasCourt ? '' : ' (keine Zimmer eingetragen)'}</div>
      </section>
    );
  };
  // bekannte Seite, aber (noch) kein Flur
  const sided = Object.entries(plan.sides).filter(([n]) => !placed.has(n) && byNumber.has(n));
  sided.forEach(([n]) => placed.add(n));
  const rest = tiles.filter((t) => !placed.has(t.number));
  return (
    <div className="fp">
      {legend && (
        <div className="fp-legend">
          {(['free', 'occupied', 'reserved', 'blocked'] as const).map((s) => <span key={s} className={`st-${s}`}><i />{ROOM_PLAN_STATUS_LABEL[s]}</span>)}
        </div>
      )}
      {plan.stairsAssumed && plan.corridors.some((c) => c.stairs !== 'none') && <p className="fp-note">Die Lage des Treppenhauses ist nur angenommen – bitte unter „Plan bearbeiten“ prüfen.</p>}
      <div className="fp-corridors">{plan.corridors.map(corridorView)}</div>
      {sided.length > 0 && (
        <section className="fp-loose">
          <header className="fp-head"><b>Noch keinem Flur zugeordnet</b><span>Gebäudeseite bekannt</span></header>
          <div className="fp-row">
            {sided.map(([n, side]) => <div key={n} className="fp-loosecell"><small className={`fp-tag ${side}`}>{side === 'street' ? 'Straßenseite' : 'Hofseite'}</small>{tile(n, side, n)}</div>)}
          </div>
        </section>
      )}
      {rest.length > 0 && (
        <section className="fp-loose">
          <header className="fp-head"><b>Weitere Zimmer</b><span>Lage noch nicht eingetragen</span></header>
          <div className="fp-row">{rest.map((t) => <div key={t.id} className="fp-loosecell">{tile(t.number, 'court', t.id)}</div>)}</div>
        </section>
      )}
    </div>
  );
}
