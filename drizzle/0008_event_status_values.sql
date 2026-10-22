-- FLOW-56 A5: move events saved under the FLOW-55 statuses to the new lifecycle.
-- booked_at is left as stored: booked events already have it, and no time is invented
-- for the others.
UPDATE "events" SET "status" = CASE "status"
	WHEN 'tentative' THEN 'pitching'
	WHEN 'booked' THEN 'closed'
	WHEN 'completed' THEN 'finished'
	WHEN 'cancelled' THEN 'lost'
END
WHERE "status" IN ('tentative', 'booked', 'completed', 'cancelled');
