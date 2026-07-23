-- ABOUTME: Quarantine-tape verdicts on individual images, keyed by the image's src URL (query preserved).
-- ABOUTME: One row per tape-over; rips accumulate in a jsonb column. Setness derives from the count per src.

CREATE TABLE IF NOT EXISTS "public"."quarantine_element_marks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "src" "text" NOT NULL,
    "type" "text" NOT NULL,
    "seed" bigint NOT NULL,
    "created_by" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "rips" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "rips_required" smallint
);


ALTER TABLE "public"."quarantine_element_marks" OWNER TO "postgres";


ALTER TABLE ONLY "public"."quarantine_element_marks"
    ADD CONSTRAINT "quarantine_element_marks_pkey" PRIMARY KEY ("id");


CREATE INDEX IF NOT EXISTS "quarantine_element_marks_src_idx" ON "public"."quarantine_element_marks" USING "btree" ("src");


GRANT ALL ON TABLE "public"."quarantine_element_marks" TO "anon";
GRANT ALL ON TABLE "public"."quarantine_element_marks" TO "authenticated";
GRANT ALL ON TABLE "public"."quarantine_element_marks" TO "service_role";
