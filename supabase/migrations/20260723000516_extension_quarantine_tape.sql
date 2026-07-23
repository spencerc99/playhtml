-- ABOUTME: Quarantine-tape verdicts — strips of caution tape laid over URLs to mark AI slop / SEO spam.
-- ABOUTME: One row per strip; rips accumulate in a jsonb column. Keyed and indexed by normalized URL.

CREATE TABLE IF NOT EXISTS "public"."quarantine_strips" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "url" "text" NOT NULL,
    "type" "text" NOT NULL,
    "a_wall" "text" NOT NULL,
    "a_t" real NOT NULL,
    "b_wall" "text" NOT NULL,
    "b_t" real NOT NULL,
    "seed" bigint NOT NULL,
    "created_by" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "rips" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "rips_required" smallint
);


ALTER TABLE "public"."quarantine_strips" OWNER TO "postgres";


ALTER TABLE ONLY "public"."quarantine_strips"
    ADD CONSTRAINT "quarantine_strips_pkey" PRIMARY KEY ("id");


CREATE INDEX IF NOT EXISTS "quarantine_strips_url_idx" ON "public"."quarantine_strips" USING "btree" ("url");


GRANT ALL ON TABLE "public"."quarantine_strips" TO "anon";
GRANT ALL ON TABLE "public"."quarantine_strips" TO "authenticated";
GRANT ALL ON TABLE "public"."quarantine_strips" TO "service_role";
