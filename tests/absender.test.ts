import { describe, expect, it } from 'vitest';
import { formFields, isRelayAddress, plausibleName, realContact } from '../src/shared/mailextract.js';

/** Absender auf Plausibilität prüfen und Kontaktformular-E-Mails auslesen (erfundene Beispiele) */
describe('Wer hat wirklich geschrieben?', () => {
  it('Namen: Menschen und Firmen ja – Systeme, Postfächer und Baukästen nein', () => {
    for (const ok of ['Erika Mustermann', 'Müller, Hans', 'Dr. Ö. Yılmaz', 'Bäckerei Schmidt GmbH', 'Anne-Marie O’Neil', 'Li Wu']) expect(plausibleName(ok), ok).toBe(true);
    for (const bad of ['MyWebsite', 'My Website', 'Kontaktformular', 'no-reply', 'info', 'Website Anfrage', 'WordPress', 'IONOS', 'Newsletter Team', 'x', '', '4711 0815 99', 'max@example.org', 'www.beispiel.de', 'Mailer-Daemon', 'Kundenservice'])
      expect(plausibleName(bad), bad).toBe(false);
  });

  it('Weiterleitungs-Adressen werden erkannt, normale nicht', () => {
    for (const a of ['no-reply@mywebsite-editor.example', 'noreply@shop.example', 'donotreply+abc@x.example', 'kontaktformular@haus.example', 'mailer-daemon@mx.example', 'wordpress@haus.example']) expect(isRelayAddress(a), a).toBe(true);
    for (const a of ['erika@example.org', 'info@firma.example', 'formann@example.org', 'websiter@example.org']) expect(isRelayAddress(a), a).toBe(false);
  });

  it('Kontaktformular (Baukasten): Name, E-Mail und Telefon stehen im Text – auch wenn alles in einer Zeile steht', () => {
    const body = 'Sie haben eine Formularnachricht über https://www.haus.example/kontakt/ erhalten. Falls Sie E-Mails über Formulare nicht unter dieser Adresse erhalten möchten, loggen Sie sich ein.\n\nName: Erika Mustermann\nE-Mail-Adresse: erika@example.org\nTelefon: 01234 56789\nNachricht: Haben Sie am Samstag um 19 Uhr einen Tisch für 4?';
    expect(realContact('MyWebsite', 'no-reply@mywebsite-editor.example', body)).toEqual({ name: 'Erika Mustermann', addr: 'erika@example.org', viaForm: true });
    const oneLine = body.replace(/\n+/g, '  ');
    expect(realContact('MyWebsite', 'no-reply@mywebsite-editor.example', oneLine)).toEqual({ name: 'Erika Mustermann', addr: 'erika@example.org', viaForm: true });
    expect(formFields(body)).toMatchObject({ name: 'Erika Mustermann', 'e-mail-adresse': 'erika@example.org', telefon: '01234 56789' });
    // Vorname und Nachname getrennt
    expect(realContact('Kontaktformular', 'formular@haus.example', 'Vorname: Max\nNachname: Muster\nE-Mail: max@example.org\nNachricht: Hallo').name).toBe('Max Muster');
  });

  it('nichts Brauchbares im Text: kein erfundener Name – das Feld bleibt leer, die Adresse bleibt die des Absenders', () => {
    expect(realContact('MyWebsite', 'no-reply@mywebsite-editor.example', 'Sie haben eine neue Nachricht.')).toEqual({ name: '', addr: 'no-reply@mywebsite-editor.example', viaForm: false });
    // Formularfeld „Name“ mit Unsinn wird nicht übernommen
    expect(realContact('MyWebsite', 'no-reply@x.example', 'Name: info\nE-Mail: keine').name).toBe('');
    // unplausibler Name bei normaler Adresse: Adresse bleibt, Name leer
    expect(realContact('info', 'info@firma.example', 'Guten Tag, wir möchten reservieren.')).toEqual({ name: '', addr: 'info@firma.example', viaForm: false });
  });

  it('normale E-Mail eines Kunden bleibt unverändert – auch wenn im Text zufällig „Name:“ steht', () => {
    expect(realContact('Erika Mustermann', 'erika@example.org', 'Hallo, bitte auf den Name: Schmidt reservieren.\nE-Mail: anders@example.org')).toEqual({ name: 'Erika Mustermann', addr: 'erika@example.org', viaForm: false });
  });

  it('eine im Formular genannte Weiterleitungs-Adresse wird nicht als Antwortadresse genommen', () => {
    expect(realContact('MyWebsite', 'no-reply@x.example', 'Name: Erika Mustermann\nE-Mail: noreply@y.example').addr).toBe('no-reply@x.example');
  });
});
