-- FLOW-277: saved wording keeps no leading or trailing line breaks (copyTextSchema
-- now trims them on save). Cleans rows saved before, e.g. "Save Changes" plus two
-- line breaks. Spaces are kept as typed. Nav wording keys (nav.<copyId>) keep
-- their current values: each fixed copyId equals the slug the key had before.
UPDATE "ui_copy"
SET "text" = regexp_replace(regexp_replace("text", '^([ \t]*[\r\n])+', ''), '([\r\n][ \t]*)+$', ''),
    "updated_at" = now()
WHERE "text" ~ '^[ \t]*[\r\n]' OR "text" ~ '[\r\n][ \t]*$';
--> statement-breakpoint
DELETE FROM "ui_copy" WHERE btrim("text", E' \t\r\n') = '';
