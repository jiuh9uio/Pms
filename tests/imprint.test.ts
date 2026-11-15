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

import { addressFromText, isMapsLink, isShortMapsLink, parseMapsLink } from '../src/shared/mapslink.js';
describe('Google-Maps-Links', () => {
  it('liest Name und Anschrift aus einem Ortslink', () => {
    const url = 'https://www.google.com/maps/place/Muster+Bau+GmbH,+Industriestra%C3%9Fe+5a,+54321+Beispielstadt/@50.1234,12.5678,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d50.1236!4d12.5681';
    expect(isMapsLink(url)).toBe(true);
    const info = parseMapsLink(url)!;
    expect(info).toEqual({ text: 'Muster Bau GmbH, Industriestraße 5a, 54321 Beispielstadt', lat: 50.1236, lng: 12.5681 });
    expect(addressFromText(info.text)).toEqual({ name: 'Muster Bau GmbH', street: 'Industriestraße 5a', zip: '54321', city: 'Beispielstadt', country: 'Deutschland' });
  });
  it('versteht Suchlinks, Einwilligungsseite, Kurzlinks und reine Koordinaten', () => {
    expect(parseMapsLink('https://maps.google.de/maps?q=Am+Markt+1,+01067+Dresden')?.text).toBe('Am Markt 1, 01067 Dresden');
    expect(addressFromText('Am Markt 1, 01067 Dresden, Deutschland')).toMatchObject({ name: '', street: 'Am Markt 1', zip: '01067', city: 'Dresden' });
    expect(addressFromText('Hauptplatz 3, 4020 Linz, Österreich')?.country).toBe('Österreich');
    const consent = `https://consent.google.com/m?continue=${encodeURIComponent('https://www.google.com/maps/place/Hotel+Beispiel/@51.05,13.73,15z')}`;
    expect(parseMapsLink(consent)).toEqual({ text: 'Hotel Beispiel', lat: 51.05, lng: 13.73 });
    expect(addressFromText('Hotel Beispiel')).toBeNull();
    expect(parseMapsLink('https://www.google.com/maps/search/51.0504,+13.7373')).toEqual({ text: '', lat: 51.0504, lng: 13.7373 });
    expect(isShortMapsLink('https://maps.app.goo.gl/AbCdEf123')).toBe(true);
    expect(isMapsLink('https://www.google.com/search?q=x')).toBe(false);
    expect(isMapsLink('https://example.org/maps/place/x')).toBe(false);
  });
});
