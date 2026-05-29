-- Add startDate to DayAssignment (nullable first to allow backfill below)
ALTER TABLE "DayAssignment" ADD COLUMN "startDate" TIMESTAMP(3);

-- Backfill from owning user's scheduleStartedAt; fall back to NOW() for
-- legacy rows where that is also null.
UPDATE "DayAssignment" da
SET "startDate" = COALESCE(u."scheduleStartedAt", NOW())
FROM "User" u
WHERE da."userId" = u."id";

-- Make non-nullable now that every row has a value
ALTER TABLE "DayAssignment" ALTER COLUMN "startDate" SET NOT NULL;

CREATE INDEX "DayAssignment_startDate_idx" ON "DayAssignment"("startDate");
