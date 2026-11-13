-- Datenschutz: Beim Anonymisieren eines Gastes dürfen die personenbezogenen Inhalte seiner Protokolleinträge
-- ersetzt werden – und nur diese. Die Anwendung setzt dafür in derselben Transaktion pms.audit_scrub auf die Gast-ID.
-- Zeitpunkt, Benutzer, Vorgang und Bezug des Eintrags bleiben erhalten; löschen bleibt verboten.
CREATE OR REPLACE FUNCTION audit_log_readonly() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- verschachtelt, damit bei TRUNCATE (ohne OLD/NEW) nicht auf OLD zugegriffen wird
  IF TG_OP = 'UPDATE' THEN
   IF OLD.entity = 'guest'
     AND OLD.entity_id = current_setting('pms.audit_scrub', true)
     AND NEW.id = OLD.id AND NEW.at = OLD.at AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id AND NEW.user_name = OLD.user_name
     AND NEW.action = OLD.action AND NEW.entity = OLD.entity AND NEW.entity_id = OLD.entity_id AND NEW.ip IS NOT DISTINCT FROM OLD.ip
     AND NEW.before IS NOT DISTINCT FROM (CASE WHEN OLD.before IS NULL THEN NULL ELSE '{"anonymisiert": true}'::jsonb END)
     AND NEW.after IS NOT DISTINCT FROM (CASE WHEN OLD.after IS NULL THEN NULL ELSE '{"anonymisiert": true}'::jsonb END) THEN
    RETURN NEW;
   END IF;
  END IF;
  RAISE EXCEPTION 'Das Änderungsprotokoll kann nicht geändert oder gelöscht werden';
END $$;
