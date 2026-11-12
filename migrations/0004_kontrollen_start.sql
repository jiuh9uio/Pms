-- Anfangswerte für den Bereich Kontrollen. Alles ist in der Anwendung änderbar;
-- die Unterlagenlisten sind Vorschläge und nicht vollständig.
INSERT INTO "inspection_types" ("name", "kind", "sort") VALUES ('Hygieneamt', 'hygiene', 1), ('Finanzamt', 'generic', 2);
--> statement-breakpoint
INSERT INTO "inspection_items" ("type_id", "text", "sort")
SELECT t.id, v.text, v.sort FROM "inspection_types" t JOIN (VALUES
  ('Hygieneamt', 'HACCP-Konzept / Eigenkontrollkonzept', 1),
  ('Hygieneamt', 'Belehrungen nach Infektionsschutzgesetz (Erst- und Folgebelehrungen)', 2),
  ('Hygieneamt', 'Hygieneschulungen der Mitarbeiter', 3),
  ('Hygieneamt', 'Reinigungs- und Desinfektionspläne', 4),
  ('Hygieneamt', 'Nachweise Schädlingsüberwachung', 5),
  ('Finanzamt', 'Verfahrensdokumentation Kasse', 1),
  ('Finanzamt', 'Tagesabschlüsse / Kassenberichte', 2),
  ('Finanzamt', 'Nachweis zur technischen Sicherheitseinrichtung (TSE) der Kasse', 3),
  ('Finanzamt', 'Ein- und Ausgangsrechnungen', 4)
) AS v(type_name, text, sort) ON v.type_name = t.name;
--> statement-breakpoint
INSERT INTO "hygiene_areas" ("name", "sort") VALUES ('Küche', 1);
