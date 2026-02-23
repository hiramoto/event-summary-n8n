CREATE TABLE IF NOT EXISTS "events" (
  "id" BIGSERIAL PRIMARY KEY,
  "event_id" TEXT NOT NULL UNIQUE,
  "type" TEXT NOT NULL,
  "ts" TIMESTAMPTZ NOT NULL,
  "device_id" TEXT,
  "payload" JSONB NOT NULL,
  "meta" JSONB,
  "received_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "processed_at" TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS "events_processed_at_idx" ON "events" ("processed_at");
CREATE INDEX IF NOT EXISTS "events_ts_idx" ON "events" ("ts");
