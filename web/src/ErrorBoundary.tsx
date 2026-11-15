import { Component, type ReactNode } from 'react';

/**
 * Fängt Fehler beim Anzeigen einer Seite ab: Statt einer leeren Seite erscheint ein Hinweis mit „Neu laden“.
 * Mit resetKey (z. B. der Adresse) wird beim Wechsel auf eine andere Seite wieder normal angezeigt.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null; key?: string }> {
  state: { error: Error | null; key?: string } = { error: null, key: this.props.resetKey };
  static getDerivedStateFromError(error: Error) { return { error }; }
  static getDerivedStateFromProps(p: { resetKey?: string }, s: { error: Error | null; key?: string }) {
    return p.resetKey !== s.key ? { error: null, key: p.resetKey } : null;
  }
  componentDidCatch(error: Error) { console.error('Anzeigefehler', error); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <section className="card">
        <h2>Diese Seite konnte nicht angezeigt werden</h2>
        <p>Im Programm ist ein Fehler aufgetreten. Ihre Daten sind davon nicht betroffen. Bitte die Seite neu laden oder über das Menü eine andere Seite öffnen.</p>
        <p className="muted small">Technische Angabe für die Fehlersuche: {this.state.error.message}</p>
        <div className="formactions"><button type="button" className="btn primary" onClick={() => window.location.reload()}>Neu laden</button></div>
      </section>
    );
  }
}
