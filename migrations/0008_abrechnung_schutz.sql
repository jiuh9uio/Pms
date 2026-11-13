-- Ausgestellte Rechnungen und Zahlungen dürfen nicht unbemerkt verändert werden.
-- Korrekturen erfolgen über Stornobelege bzw. Gegenbuchungen.

CREATE FUNCTION invoices_protect() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN RAISE EXCEPTION 'Ausgestellte Rechnungen können nicht gelöscht werden'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'draft' THEN RETURN NEW; END IF;
  -- Einzige erlaubte Änderung: ausgestellt -> storniert (nur Status, Stornogrund, Zeitstempel/Version)
  IF OLD.status = 'issued' AND NEW.status = 'cancelled'
     AND (to_jsonb(NEW) - 'status' - 'cancel_reason' - 'updated_at' - 'version') = (to_jsonb(OLD) - 'status' - 'cancel_reason' - 'updated_at' - 'version') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Ausgestellte Rechnungen können nicht geändert werden – bitte stornieren';
END $$;
--> statement-breakpoint
CREATE TRIGGER invoices_protect BEFORE UPDATE OR DELETE ON "invoices" FOR EACH ROW EXECUTE FUNCTION invoices_protect();
--> statement-breakpoint

CREATE FUNCTION invoice_lines_protect() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM invoices WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id);
  IF st IS NOT NULL AND st <> 'draft' THEN
    RAISE EXCEPTION 'Positionen ausgestellter Rechnungen können nicht geändert werden';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
--> statement-breakpoint
CREATE TRIGGER invoice_lines_protect BEFORE INSERT OR UPDATE OR DELETE ON "invoice_lines" FOR EACH ROW EXECUTE FUNCTION invoice_lines_protect();
--> statement-breakpoint

CREATE FUNCTION payments_protect() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Erlaubt ist nur, eine noch keiner Rechnung zugeordnete Zahlung (Anzahlung) einer Rechnung zuzuordnen.
  IF TG_OP = 'UPDATE' AND OLD.invoice_id IS NULL AND NEW.invoice_id IS NOT NULL
     AND (to_jsonb(NEW) - 'invoice_id') = (to_jsonb(OLD) - 'invoice_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Zahlungen können nicht geändert oder gelöscht werden – bitte eine Gegenbuchung erfassen';
END $$;
--> statement-breakpoint
CREATE TRIGGER payments_protect BEFORE UPDATE OR DELETE ON "payments" FOR EACH ROW EXECUTE FUNCTION payments_protect();
--> statement-breakpoint
CREATE TRIGGER payments_no_truncate BEFORE TRUNCATE ON "payments" FOR EACH STATEMENT EXECUTE FUNCTION payments_protect();
--> statement-breakpoint
CREATE FUNCTION invoices_no_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Rechnungen können nicht gelöscht werden';
END $$;
--> statement-breakpoint
CREATE TRIGGER invoices_no_truncate BEFORE TRUNCATE ON "invoices" FOR EACH STATEMENT EXECUTE FUNCTION invoices_no_truncate();
