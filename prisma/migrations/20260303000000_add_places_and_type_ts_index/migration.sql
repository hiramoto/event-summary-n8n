-- CreateTable
CREATE TABLE "places" (
  "place_id" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "lat" DOUBLE PRECISION,
  "lng" DOUBLE PRECISION,
  "radius_m" INTEGER NOT NULL DEFAULT 100,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "places_pkey" PRIMARY KEY ("place_id")
);

-- Replace single-column ts index with composite (type, ts)
DROP INDEX IF EXISTS "events_ts_idx";
CREATE INDEX "events_type_ts_idx" ON "events" ("type", "ts");
