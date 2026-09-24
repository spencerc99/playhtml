-- Every stored room document carries a version that changes whenever its
-- document changes, however it is written (PartyServer saves, admin tools, or
-- manual edits). PartyServer keeps a copy of the last document it saved in
-- Durable Object storage and only trusts that copy when its version still
-- matches this column.
ALTER TABLE "public"."documents"
  ADD COLUMN "version" uuid NOT NULL DEFAULT gen_random_uuid();

CREATE OR REPLACE FUNCTION "public"."documents_set_version"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.version := gen_random_uuid();
  RETURN NEW;
END;
$$;

CREATE TRIGGER "documents_set_version"
  BEFORE INSERT OR UPDATE OF "document" ON "public"."documents"
  FOR EACH ROW
  EXECUTE FUNCTION "public"."documents_set_version"();
