-- The day-of update log is append-only: a correction is a new update (FLOW-156).
CREATE FUNCTION "day_of_updates_append_only"() RETURNS trigger
	LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
	RAISE EXCEPTION 'day_of_updates is append-only; record a new update instead';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "day_of_updates_append_only" BEFORE UPDATE OR DELETE ON "day_of_updates"
	FOR EACH ROW EXECUTE FUNCTION "day_of_updates_append_only"();
