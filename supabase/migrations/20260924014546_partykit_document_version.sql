-- Every stored room document carries a version that changes whenever its
-- document changes, however it is written (PartyServer saves, admin tools, or
-- manual edits). PartyServer keeps a copy of the last document it saved in
-- Durable Object storage and only trusts that copy when its version still
-- matches this column.
--
-- The column is nullable with no default so adding it is a metadata-only
-- change: a volatile default would rewrite the whole table under an exclusive
-- lock. Existing rows stay NULL until their next save, and a NULL version is
-- never trusted, so those rooms keep loading from the database until then.
ALTER TABLE "public"."documents"
  ADD COLUMN "version" uuid;

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
