-- Geschäftskritische Zusicherungen, die die Datenbank selbst durchsetzt.

-- 1) Keine Doppelbelegung: zwei aktive Belegungen desselben Zimmers dürfen sich nicht überschneiden.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "room_allocations"
  ADD CONSTRAINT "room_allocations_no_overlap"
  EXCLUDE USING gist ("room_id" WITH =, "period" WITH &&) WHERE ("active");
--> statement-breakpoint
ALTER TABLE "room_allocations"
  ADD CONSTRAINT "room_allocations_period_valid"
  CHECK (NOT isempty("period") AND lower("period") IS NOT NULL AND upper("period") IS NOT NULL);
--> statement-breakpoint

-- 2) Änderungsprotokoll ist nur anfügbar.
CREATE FUNCTION audit_log_readonly() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Das Änderungsprotokoll kann nicht geändert oder gelöscht werden';
END $$;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_change BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION audit_log_readonly();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON "audit_log"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_readonly();
--> statement-breakpoint

-- 3) Höchstens ein Standard-Steuersatz je Verwendung.
CREATE UNIQUE INDEX "tax_rates_default_unique" ON "tax_rates" ("default_for") WHERE "default_for" IS NOT NULL AND "active";
--> statement-breakpoint

-- Anfangswerte (im PMS unter Einstellungen änderbar)
INSERT INTO "tax_rates" ("name", "rate_percent", "default_for") VALUES
  ('Übernachtung (ermäßigt)', 7, 'lodging'),
  ('Regelsteuersatz', 19, 'services');
