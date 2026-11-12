import { and, desc, eq, lt } from 'drizzle-orm';
import type { Exec } from '../db/client.js';
import { auditLog } from '../db/schema.js';

/** Wer handelt – wird aus der Anfrage gebildet und an jede schreibende Funktion übergeben. */
export interface Actor { userId: string | null; userName: string; ip: string | null }
export const SYSTEM: Actor = { userId: null, userName: 'System', ip: null };

export interface AuditEntry { action: string; entity: string; entityId?: string | null; before?: unknown; after?: unknown }

/** Schreibt einen Protokolleintrag – immer in derselben Transaktion wie die Änderung selbst. */
export async function record(db: Exec, actor: Actor, e: AuditEntry) {
  await db.insert(auditLog).values({
    userId: actor.userId, userName: actor.userName, ip: actor.ip,
    action: e.action, entity: e.entity, entityId: e.entityId ?? null, before: e.before ?? null, after: e.after ?? null,
  });
}

export async function listAudit(db: Exec, f: { entity?: string; entityId?: string; userId?: string; before?: number; limit: number }) {
  const where = and(
    f.entity ? eq(auditLog.entity, f.entity) : undefined,
    f.entityId ? eq(auditLog.entityId, f.entityId) : undefined,
    f.userId ? eq(auditLog.userId, f.userId) : undefined,
    f.before ? lt(auditLog.id, f.before) : undefined,
  );
  const rows = await db.select().from(auditLog).where(where).orderBy(desc(auditLog.id)).limit(f.limit + 1);
  const items = rows.slice(0, f.limit);
  return { items, nextCursor: rows.length > f.limit ? items[items.length - 1]!.id : null };
}
