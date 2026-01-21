-- AlterTable: Add missing ExerciseLog columns that exist in Prisma schema but were never migrated.
-- These are used when including exerciseLogs in workoutLog queries (e.g. workout/live findFirst).
ALTER TABLE "ExerciseLog" ADD COLUMN     "duration" INTEGER,
ADD COLUMN     "distance" DOUBLE PRECISION,
ADD COLUMN     "roundsCompleted" INTEGER,
ADD COLUMN     "timeElapsed" INTEGER,
ADD COLUMN     "performanceData" JSONB;
