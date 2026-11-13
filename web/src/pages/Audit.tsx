import { Fragment, useEffect, useState } from 'react';
import type { AuditDto, UserDto } from '../../../src/shared/schemas.js';
import { api } from '../api.ts';
import { Button, LoadState, PageHeader, fmtDateTime, useLoad } from '../ui.tsx';

const ENTITY: Record<string, string> = {
  user: 'Benutzer', session: 'Anmeldung', settings: 'Einstellungen', tax_rate: 'Steuersatz',
  booking: 'Reservierung', guest: 'Gast', block: 'Zimmersperre', category: 'Kategorie', room: 'Zimmer', rate_rule: 'Preisregel', service: 'Leistung',
  inspection_type: 'Kontrollart', inspection_item: 'Unterlage', inspection_visit: 'Kontrollbesuch', hygiene_area: 'Bereich', hygiene_point: 'Messstelle', hygiene_reading: 'Messwert',
};
const ACTION: Record<string, string> = {
  setup: 'Ersteinrichtung', create: 'angelegt', update: 'geändert', password_reset: 'Passwort zurückgesetzt', password_changed: 'Passwort geändert',
  remove: 'entfernt', correct: 'korrigiert', confirm: 'im Sollbereich bestätigt', create_many: 'mehrere angelegt', status: 'Status geändert', room_add: 'Zimmer hinzugefügt', room_update: 'Zimmerbuchung geändert',
  charge_add: 'Leistung hinzugefügt', charge_remove: 'Leistung entfernt',
  login: 'Anmeldung', logout: 'Abmeldung', login_failed: 'Fehlgeschlagene Anmeldung', login_locked: 'Konto nach Fehlversuchen gesperrt',
};
const FIELD: Record<string, string> = {
  modules: 'Bereiche', area: 'Bereich', points: 'Messstellen', valueC: 'Wert in °C', point: 'Messstelle', date: 'Datum', note: 'Bemerkung', enteredBy: 'Eingetragen von', text: 'Unterlage', ready: 'Liegt bereit', inspector: 'Prüfer', result: 'Ergebnis',
  name: 'Name', username: 'Benutzername', role: 'Rolle', active: 'Aktiv', ratePercent: 'Satz in %', defaultFor: 'Standard für',
  street: 'Straße', zip: 'PLZ', city: 'Ort', country: 'Land', phone: 'Telefon', email: 'E-Mail', website: 'Website', taxNumber: 'Steuernummer',
  vatId: 'USt-IdNr.', bankName: 'Bank', iban: 'IBAN', bic: 'BIC', checkinTime: 'Check-in ab', checkoutTime: 'Check-out bis',
};

export function describeAudit(e: AuditDto) {
  const action = ACTION[e.action] ?? e.action;
  if (e.entity === 'session') return action;
  const name = (e.after as { name?: string } | null)?.name ?? (e.before as { name?: string } | null)?.name;
  return `${ENTITY[e.entity] ?? e.entity}${name && e.entity !== 'settings' ? ` „${name}“` : ''}: ${action}`;
}

const show = (v: unknown) => (v === null || v === undefined || v === '' ? '–' : typeof v === 'boolean' ? (v ? 'ja' : 'nein') : String(v));
function changes(e: AuditDto) {
  const b = (e.before ?? {}) as Record<string, unknown>;
  const a = (e.after ?? {}) as Record<string, unknown>;
  return [...new Set([...Object.keys(b), ...Object.keys(a)])]
    .filter((k) => !['id', 'version', 'createdAt', 'lastLoginAt', 'lockedUntil'].includes(k) && JSON.stringify(b[k]) !== JSON.stringify(a[k]))
    .map((k) => ({ key: k, label: FIELD[k] ?? k, before: e.before ? show(b[k]) : null, after: e.after ? show(a[k]) : null }));
}

export function Audit() {
  const [entity, setEntity] = useState('');
  const [userId, setUserId] = useState('');
  const [items, setItems] = useState<AuditDto[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<number | null>(null);
  const users = useLoad(() => api<UserDto[]>('GET', '/users'));

  const load = async (before: number | null) => {
    setLoading(true);
    const q = new URLSearchParams({ limit: '50' });
    if (entity) q.set('entity', entity);
    if (userId) q.set('userId', userId);
    if (before) q.set('before', String(before));
    try {
      const r = await api<{ items: AuditDto[]; nextCursor: number | null }>('GET', '/audit?' + q);
      setItems((cur) => (before ? [...cur, ...r.items] : r.items));
      setCursor(r.nextCursor);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler');
    }
    setLoading(false);
  };
  useEffect(() => { void load(null); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [entity, userId]);

  return (
    <>
      <PageHeader title="Protokoll" sub="Lückenlose Aufzeichnung wichtiger Änderungen. Einträge können nicht bearbeitet oder gelöscht werden." />
      <div className="filters">
        <select value={entity} onChange={(e) => setEntity(e.target.value)} aria-label="Bereich">
          <option value="">Alle Bereiche</option>
          {Object.entries(ENTITY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select value={userId} onChange={(e) => setUserId(e.target.value)} aria-label="Benutzer">
          <option value="">Alle Benutzer</option>
          {users.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </div>
      <LoadState error={error} loading={loading && !items.length} />
      {!loading && !items.length && !error && <p className="muted">Keine Einträge.</p>}
      {items.length > 0 && (
        <div className="tablewrap card flush">
          <table>
            <thead><tr><th>Zeitpunkt</th><th>Benutzer</th><th>Vorgang</th><th className="hide-sm">Adresse</th></tr></thead>
            <tbody>
              {items.map((e) => {
                const ch = changes(e);
                return (
                  <Fragment key={e.id}>
                    <tr className={ch.length ? 'rowlink' : ''} tabIndex={ch.length ? 0 : undefined} aria-expanded={ch.length ? open === e.id : undefined}
                      onClick={() => ch.length && setOpen(open === e.id ? null : e.id)}
                      onKeyDown={(k) => { if (k.key === 'Enter' && ch.length) setOpen(open === e.id ? null : e.id); }}>
                      <td className="nowrap muted">{fmtDateTime(e.at)}</td>
                      <td>{e.userName || '–'}</td>
                      <td>{describeAudit(e)}{ch.length > 0 && <span className="muted"> · {ch.length} {ch.length === 1 ? 'Feld' : 'Felder'} {open === e.id ? '▴' : '▾'}</span>}</td>
                      <td className="muted hide-sm">{e.ip ?? '–'}</td>
                    </tr>
                    {open === e.id && (
                      <tr className="detail"><td colSpan={4}>
                        <dl className="diff">
                          {ch.map((c) => (
                            <div key={c.key}><dt>{c.label}</dt><dd>{c.before !== null && <span className="old">{c.before}</span>}{c.before !== null && c.after !== null && ' → '}{c.after !== null && <span className="new">{c.after}</span>}</dd></div>
                          ))}
                        </dl>
                      </td></tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {cursor && <p><Button busy={loading} onClick={() => void load(cursor)}>Ältere Einträge laden</Button></p>}
    </>
  );
}
