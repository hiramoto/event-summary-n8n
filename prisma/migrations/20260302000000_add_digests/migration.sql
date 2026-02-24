CREATE TABLE "digests" (
  "id" BIGSERIAL NOT NULL,
  "digest_id" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "message" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sent_at" TIMESTAMP(3),

  CONSTRAINT "digests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "digests_digest_id_key" ON "digests"("digest_id");
CREATE INDEX "digests_sent_at_idx" ON "digests"("sent_at");
CREATE INDEX "digests_created_at_idx" ON "digests"("created_at");
