import { useState } from 'react';
import type { GuestFormLink } from '../../../src/shared/hotel.js';
import { api } from '../api.ts';
import { Badge, Button, Dialog, LoadState, fmtDateTime, useLoad, useToast } from '../ui.tsx';

/** QR-Code, über den der Gast den Meldeschein am eigenen Handy ausfüllt. */
export function GuestFormDialog({ bookingId, number, onClose }: { bookingId: string; number: string; onClose: () => void }) {
  const toast = useToast();
  const { data, error } = useLoad(() => api<GuestFormLink>('GET', `/bookings/${bookingId}/guest-form`), [bookingId]);
  const [link, setLink] = useState<GuestFormLink | null>(null);
  const [busy, setBusy] = useState(false);
  const s = link ?? data;
  const create = async () => {
    if (s?.exists && !window.confirm(s.submittedAt ? 'Neuen QR-Code erzeugen? Der Gast kann den Meldeschein dann noch einmal ausfüllen.' : 'Neuen QR-Code erzeugen? Der bisherige wird ungültig.')) return;
    setBusy(true);
    try { setLink(await api<GuestFormLink>('POST', `/bookings/${bookingId}/guest-form`, {})); } catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
    setBusy(false);
  };
  return (
    <Dialog title={`Meldeschein per QR-Code · ${number}`} onClose={onClose}
      footer={<Button onClick={onClose}>Schließen</Button>}>
      {!s ? <LoadState error={error} loading /> : (
        <div className="qrbox">
          {s.submittedAt && <p><Badge tone="ok">ausgefüllt</Badge> Der Gast hat den Meldeschein am {fmtDateTime(s.submittedAt)} ausgefüllt. Die Angaben stehen im Gästeprofil.</p>}
          {link?.qr ? (
            <>
              <img src={link.qr} alt="QR-Code zum Online-Meldeschein" width={240} height={240} />
              <p className="qrurl">{link.url}</p>
              <p className="muted small">
                Der Gast scannt den Code mit der Handy-Kamera und füllt den Meldeschein selbst aus. Gültig bis {fmtDateTime(link.expiresAt)}, für eine Abgabe.
                {link.localOnly && <> <b>Das Handy muss dafür im WLAN des Hauses sein</b> und der PMS-Rechner von dort erreichbar – von unterwegs funktioniert der Code nicht.</>}
                {' '}Der Code wird aus Sicherheitsgründen nur jetzt angezeigt; später lässt sich ein neuer erzeugen.
              </p>
            </>
          ) : (
            <>
              {s.exists && !s.submittedAt && <p>Für diese Reservierung wurde bereits ein QR-Code erzeugt (gültig bis {fmtDateTime(s.expiresAt)}), der Gast hat noch nichts eingetragen.</p>}
              {!s.exists && <p>Der Gast kann seine Angaben für den Meldeschein am eigenen Handy eintragen. Sie landen im Gästeprofil und erscheinen auf dem gedruckten Meldeschein.</p>}
              <p><Button variant="primary" busy={busy} onClick={() => void create()}>{s.exists ? 'Neuen QR-Code erzeugen' : 'QR-Code erzeugen'}</Button></p>
            </>
          )}
        </div>
      )}
    </Dialog>
  );
}
