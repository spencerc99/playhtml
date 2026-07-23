-- ABOUTME: Recreates the production Supabase public schema for local and preview databases.
-- ABOUTME: Baselines the extension and PartyKit tables without copying production data.


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."daily_event_counts"("event_type" "text" DEFAULT NULL::"text", "from_date" timestamp with time zone DEFAULT NULL::timestamp with time zone, "to_date" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS TABLE("day" "date", "count" bigint)
    LANGUAGE "plpgsql" STABLE
    AS $$
BEGIN
  RETURN QUERY
  SELECT date_trunc('day', ts)::date AS day, count(*) AS count
  FROM collection_events
  WHERE (event_type IS NULL OR type = event_type)
    AND (from_date IS NULL OR ts >= from_date)
    AND (to_date IS NULL OR ts <= to_date)
  GROUP BY 1
  ORDER BY 1;
END;
$$;


ALTER FUNCTION "public"."daily_event_counts"("event_type" "text", "from_date" timestamp with time zone, "to_date" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_url_trails"("target_url" "text", "since_ts" timestamp with time zone, "exclude_pid" "text" DEFAULT NULL::"text", "row_limit" integer DEFAULT 5000) RETURNS TABLE("participant_id" "text", "ts" timestamp with time zone, "viewport_width" integer, "viewport_height" integer, "data" "jsonb")
    LANGUAGE "sql" STABLE
    AS $$
  SELECT
    e.participant_id,
    e.ts,
    e.viewport_width,
    e.viewport_height,
    e.data
  FROM collection_events e
  WHERE e.type = 'cursor'
    AND md5(e.url) = md5(target_url)
    AND e.url = target_url
    AND e.ts >= since_ts
    AND (exclude_pid IS NULL OR e.participant_id <> exclude_pid)
  ORDER BY e.ts DESC
  LIMIT row_limit;
$$;


ALTER FUNCTION "public"."get_url_trails"("target_url" "text", "since_ts" timestamp with time zone, "exclude_pid" "text", "row_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."increment_daily_count"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  INSERT INTO daily_counts (day, type, count)
  VALUES (date_trunc('day', NEW.ts)::date, NEW.type, 1)
  ON CONFLICT (day, type)
  DO UPDATE SET count = daily_counts.count + 1;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."increment_daily_count"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."collection_events" (
    "id" "text" NOT NULL,
    "type" "text" NOT NULL,
    "ts" timestamp with time zone NOT NULL,
    "participant_id" "text" NOT NULL,
    "session_id" "text" NOT NULL,
    "url" "text",
    "viewport_width" integer,
    "viewport_height" integer,
    "timezone" "text",
    "data" "jsonb" NOT NULL,
    "domain" "text" GENERATED ALWAYS AS ("regexp_replace"("regexp_replace"("regexp_replace"("regexp_replace"("url", '^https?://'::"text", ''::"text"), '^www\.'::"text", ''::"text"), '/.*$'::"text", ''::"text"), ':[0-9]+$'::"text", ''::"text")) STORED
);


ALTER TABLE "public"."collection_events" OWNER TO "postgres";


COMMENT ON TABLE "public"."collection_events" IS 'Stores browsing behavior events collected by the extension';



COMMENT ON COLUMN "public"."collection_events"."id" IS 'ULID - Universally Unique Lexicographically Sortable Identifier';



COMMENT ON COLUMN "public"."collection_events"."participant_id" IS 'Anonymous participant ID (persistent across sessions)';



COMMENT ON COLUMN "public"."collection_events"."session_id" IS 'Browser session ID (unique per session)';



COMMENT ON COLUMN "public"."collection_events"."data" IS 'Type-specific event payload (JSON)';



CREATE TABLE IF NOT EXISTS "public"."daily_counts" (
    "day" "date" NOT NULL,
    "type" "text" NOT NULL,
    "count" bigint DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."daily_counts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."documents" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "document" "text",
    "name" "text"
);


ALTER TABLE "public"."documents" OWNER TO "postgres";


ALTER TABLE "public"."documents" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."documents_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."page_metadata_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "page_ref" "text" NOT NULL,
    "canonical_url" "text" NOT NULL,
    "title" "text" NOT NULL,
    "favicon_url" "text" NOT NULL,
    "metadata_hash" "text" NOT NULL,
    "valid_from_ts" timestamp with time zone NOT NULL,
    "valid_to_ts" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."page_metadata_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."participants" (
    "pid" "text" NOT NULL,
    "cursor_color" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."participants" OWNER TO "postgres";


COMMENT ON TABLE "public"."participants" IS 'Participant identity and display preferences';



COMMENT ON COLUMN "public"."participants"."pid" IS 'ECDSA P-256 public key hex, prefixed pk_';



COMMENT ON COLUMN "public"."participants"."cursor_color" IS 'Hex color string chosen by participant';



ALTER TABLE ONLY "public"."collection_events"
    ADD CONSTRAINT "collection_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."daily_counts"
    ADD CONSTRAINT "daily_counts_pkey" PRIMARY KEY ("day", "type");



ALTER TABLE ONLY "public"."documents"
    ADD CONSTRAINT "documents_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."documents"
    ADD CONSTRAINT "documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."page_metadata_history"
    ADD CONSTRAINT "page_metadata_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."participants"
    ADD CONSTRAINT "participants_pkey" PRIMARY KEY ("pid");



CREATE INDEX "idx_events_ts" ON "public"."collection_events" USING "btree" ("ts" DESC);



CREATE INDEX "idx_events_type_ts_desc" ON "public"."collection_events" USING "btree" ("type", "ts" DESC);



CREATE INDEX "idx_events_urlhash_ts" ON "public"."collection_events" USING "btree" ("md5"("url"), "ts" DESC);



CREATE INDEX "idx_page_metadata_history_current" ON "public"."page_metadata_history" USING "btree" ("page_ref") WHERE ("valid_to_ts" IS NULL);



CREATE INDEX "idx_page_metadata_history_page_ref" ON "public"."page_metadata_history" USING "btree" ("page_ref");



CREATE INDEX "idx_page_metadata_history_valid_from" ON "public"."page_metadata_history" USING "btree" ("valid_from_ts" DESC);



CREATE INDEX "idx_participants_updated" ON "public"."participants" USING "btree" ("updated_at" DESC);



CREATE OR REPLACE TRIGGER "trg_daily_count" AFTER INSERT ON "public"."collection_events" FOR EACH ROW EXECUTE FUNCTION "public"."increment_daily_count"();



ALTER TABLE "public"."collection_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."daily_counts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."documents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."page_metadata_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."participants" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."daily_event_counts"("event_type" "text", "from_date" timestamp with time zone, "to_date" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."daily_event_counts"("event_type" "text", "from_date" timestamp with time zone, "to_date" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."daily_event_counts"("event_type" "text", "from_date" timestamp with time zone, "to_date" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_url_trails"("target_url" "text", "since_ts" timestamp with time zone, "exclude_pid" "text", "row_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_url_trails"("target_url" "text", "since_ts" timestamp with time zone, "exclude_pid" "text", "row_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_url_trails"("target_url" "text", "since_ts" timestamp with time zone, "exclude_pid" "text", "row_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."increment_daily_count"() TO "anon";
GRANT ALL ON FUNCTION "public"."increment_daily_count"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."increment_daily_count"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";



GRANT ALL ON TABLE "public"."collection_events" TO "anon";
GRANT ALL ON TABLE "public"."collection_events" TO "authenticated";
GRANT ALL ON TABLE "public"."collection_events" TO "service_role";



GRANT ALL ON TABLE "public"."daily_counts" TO "anon";
GRANT ALL ON TABLE "public"."daily_counts" TO "authenticated";
GRANT ALL ON TABLE "public"."daily_counts" TO "service_role";



GRANT ALL ON TABLE "public"."documents" TO "anon";
GRANT ALL ON TABLE "public"."documents" TO "authenticated";
GRANT ALL ON TABLE "public"."documents" TO "service_role";



GRANT ALL ON SEQUENCE "public"."documents_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."documents_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."documents_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."page_metadata_history" TO "anon";
GRANT ALL ON TABLE "public"."page_metadata_history" TO "authenticated";
GRANT ALL ON TABLE "public"."page_metadata_history" TO "service_role";



GRANT ALL ON TABLE "public"."participants" TO "anon";
GRANT ALL ON TABLE "public"."participants" TO "authenticated";
GRANT ALL ON TABLE "public"."participants" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "service_role";
