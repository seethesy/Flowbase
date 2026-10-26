-- FLOW-208: booked_at is when the client signed the event's first contract (FLOW-4),
-- not the first time the event reached Negotiation (FLOW-56 A6). Clear the values the
-- A6 rule stamped: it set booked_at in the same transaction that wrote a status
-- history row, so booked_at sits within seconds of one. Values kept from the old
-- booked status (0009) predate status history and stay.
UPDATE "events" SET "booked_at" = NULL
WHERE "booked_at" IS NOT NULL
	AND EXISTS (
		SELECT 1 FROM "event_status_history" h
		WHERE h."event_id" = "events"."id"
			AND h."created_at" BETWEEN "events"."booked_at" - interval '1 minute'
				AND "events"."booked_at" + interval '1 minute'
	);
