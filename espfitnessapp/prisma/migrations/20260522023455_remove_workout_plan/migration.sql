-- Remove WorkoutPlan and attach the schedule (day assignments + rotations) directly
-- to the User. This migration is DATA-PRESERVING: the active plan's day assignments
-- and rotations are carried over (same primary keys, so session/rotation links stay
-- intact); completed WorkoutSessions and ExerciseEntry history are untouched.
--
-- Only the ACTIVE plan's schedule is migrated. Assignments/rotations belonging to
-- non-active (archived) plans are dropped — they were never used by the app and would
-- collide with the new @@unique([userId, dayOfWeek, order]) constraint.

-- ── WorkoutSession: drop the now-pointless plan link (rows are preserved) ──────────
ALTER TABLE "WorkoutSession" DROP CONSTRAINT "WorkoutSession_planId_fkey";
DROP INDEX "WorkoutSession_planId_idx";
ALTER TABLE "WorkoutSession" DROP COLUMN "planId";

-- ── WorkoutRotation: planId -> userId (backfilled from the owning active plan) ─────
ALTER TABLE "WorkoutRotation" ADD COLUMN "userId" TEXT;

UPDATE "WorkoutRotation" wr
SET "userId" = wp."userId"
FROM "WorkoutPlan" wp
WHERE wr."planId" = wp."id" AND wp."status" = 'active';

-- Drop rotations that belonged to non-active plans (cascades to their RotationEntry;
-- any session.rotationId pointing at them is SET NULL, so sessions are preserved).
DELETE FROM "WorkoutRotation" WHERE "userId" IS NULL;

ALTER TABLE "WorkoutRotation" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "WorkoutRotation" DROP CONSTRAINT "WorkoutRotation_planId_fkey";
DROP INDEX "WorkoutRotation_planId_idx";
ALTER TABLE "WorkoutRotation" DROP COLUMN "planId";

CREATE INDEX "WorkoutRotation_userId_idx" ON "WorkoutRotation"("userId");
ALTER TABLE "WorkoutRotation" ADD CONSTRAINT "WorkoutRotation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── DayAssignment: new table, populated from the active plan's PlanDayAssignment ───
CREATE TABLE "DayAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "workoutTypeId" TEXT,
    "rotationId" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DayAssignment_pkey" PRIMARY KEY ("id")
);

-- Carry over the active plan's assignments (keep the same id so nothing else breaks).
INSERT INTO "DayAssignment" ("id", "userId", "dayOfWeek", "workoutTypeId", "rotationId", "order")
SELECT pda."id", wp."userId", pda."dayOfWeek", pda."workoutTypeId", pda."rotationId", pda."order"
FROM "PlanDayAssignment" pda
JOIN "WorkoutPlan" wp ON pda."planId" = wp."id"
WHERE wp."status" = 'active';

-- ── Drop the old plan tables (data already copied / no longer referenced) ──────────
DROP TABLE "PlanDayAssignment";
ALTER TABLE "WorkoutPlan" DROP CONSTRAINT "WorkoutPlan_userId_fkey";
DROP TABLE "WorkoutPlan";

-- ── DayAssignment indexes + foreign keys (canonical Prisma names) ─────────────────
CREATE INDEX "DayAssignment_userId_idx" ON "DayAssignment"("userId");
CREATE INDEX "DayAssignment_workoutTypeId_idx" ON "DayAssignment"("workoutTypeId");
CREATE INDEX "DayAssignment_rotationId_idx" ON "DayAssignment"("rotationId");
CREATE UNIQUE INDEX "DayAssignment_userId_dayOfWeek_order_key" ON "DayAssignment"("userId", "dayOfWeek", "order");

ALTER TABLE "DayAssignment" ADD CONSTRAINT "DayAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DayAssignment" ADD CONSTRAINT "DayAssignment_workoutTypeId_fkey" FOREIGN KEY ("workoutTypeId") REFERENCES "WorkoutType"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DayAssignment" ADD CONSTRAINT "DayAssignment_rotationId_fkey" FOREIGN KEY ("rotationId") REFERENCES "WorkoutRotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
