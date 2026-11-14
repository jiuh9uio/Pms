import { describe, expect, it } from 'vitest';
import { extractCompany, findImprintLink, htmlToLines } from '../src/shared/imprint.js';

describe('Firmendaten aus dem Impressum', () => {
  it('liest ein übliches Impressum', () => {
    const html = `<html><head><title>x</title><style>p{}</style></head><body><nav><a href="/">Start</a></nav><h1>Impressum</h1><p>Angaben gem&auml;&szlig; &sect; 5 DDG</p>
      <p>Muster Bau GmbH &amp; Co. KG<br>Industriestra&szlig;e 5a<br>54321 Beispielstadt</p><p>Vertreten durch: Max Muster</p>
      <p>Telefon: +49 (0) 30 / 123 45-67<br>E-Mail: info(at)muster-bau.example</p><p>Umsatzsteuer-ID: DE 123456789</p><script>var x = "99999 Falsch";</script></body></html>`;
    expect(extractCompany(html)).toEqual({ name: 'Muster Bau GmbH & Co. KG', street: 'Industriestraße 5a', zip: '54321', city: 'Beispielstadt', country: 'Deutschland',
      phone: '+49 (0) 30 / 123 45-67', email: 'info@muster-bau.example', vatId: 'DE123456789', source: 'Text der Seite' });
  });
  it('bevorzugt strukturierte Angaben der Seite', () => {
    const html = `<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebSite","name":"x"},{"@type":"LocalBusiness","name":"Hotel Beispiel","telephone":"+49 351 1234",
      "email":"mailto:kontakt@hotel.example","address":{"@type":"PostalAddress","streetAddress":"Am Markt 1","postalCode":"01067","addressLocality":"Dresden","addressCountry":"DE"}}]}</script><p>Impressum</p>`;
    expect(extractCompany(html)).toMatchObject({ name: 'Hotel Beispiel', street: 'Am Markt 1', zip: '01067', city: 'Dresden', country: 'Deutschland', phone: '+49 351 1234', email: 'kontakt@hotel.example', source: 'strukturierte Angaben der Seite' });
  });
  it('findet den Link zum Impressum und erfindet nichts', () => {
    expect(findImprintLink('<a href="/kontakt">Kontakt</a> <a class="f" href="rechtliches/impressum.html"><span>Impressum</span></a>', 'https://firma.example/de/')).toBe('https://firma.example/de/rechtliches/impressum.html');
    expect(findImprintLink('<a href="/a">A</a>', 'https://firma.example/')).toBeNull();
    expect(extractCompany('<p>Willkommen auf unserer Seite</p>')).toBeNull();
    expect(htmlToLines('<div>a<br>b</div><p>c &ndash; d</p>')).toEqual(['a', 'b', 'c – d']);
  });
  it('erkennt Österreich an der vierstelligen Postleitzahl', () => {
    expect(extractCompany('<h1>Impressum</h1><p>Gasthof Alpenblick e.U.</p><p>Dorfstraße 12</p><p>6020 Innsbruck</p><p>UID: ATU12345678</p>')).toMatchObject({ zip: '6020', city: 'Innsbruck', country: 'Österreich', vatId: 'ATU12345678', street: 'Dorfstraße 12' });
  });
});
