/*
  Warnings:

  - A unique constraint covering the columns `[planId,dayOfWeek,order]` on the table `PlanDayAssignment` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "PlanDayAssignment_planId_dayOfWeek_key";

-- AlterTable
ALTER TABLE "PlanDayAssignment" ADD COLUMN     "order" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "rotationId" TEXT,
ALTER COLUMN "workoutTypeId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "WorkoutSession" ADD COLUMN     "rotationId" TEXT;

-- CreateTable
CREATE TABLE "WorkoutRotation" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currentIndex" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "WorkoutRotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RotationEntry" (
    "id" TEXT NOT NULL,
    "rotationId" TEXT NOT NULL,
    "workoutTypeId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "RotationEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkoutRotation_planId_idx" ON "WorkoutRotation"("planId");

-- CreateIndex
CREATE INDEX "RotationEntry_rotationId_idx" ON "RotationEntry"("rotationId");

-- CreateIndex
CREATE INDEX "RotationEntry_workoutTypeId_idx" ON "RotationEntry"("workoutTypeId");

-- CreateIndex
CREATE INDEX "PlanDayAssignment_rotationId_idx" ON "PlanDayAssignment"("rotationId");

-- CreateIndex
CREATE UNIQUE INDEX "PlanDayAssignment_planId_dayOfWeek_order_key" ON "PlanDayAssignment"("planId", "dayOfWeek", "order");

-- CreateIndex
CREATE INDEX "WorkoutSession_rotationId_idx" ON "WorkoutSession"("rotationId");

-- AddForeignKey
ALTER TABLE "PlanDayAssignment" ADD CONSTRAINT "PlanDayAssignment_rotationId_fkey" FOREIGN KEY ("rotationId") REFERENCES "WorkoutRotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutRotation" ADD CONSTRAINT "WorkoutRotation_planId_fkey" FOREIGN KEY ("planId") REFERENCES "WorkoutPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RotationEntry" ADD CONSTRAINT "RotationEntry_rotationId_fkey" FOREIGN KEY ("rotationId") REFERENCES "WorkoutRotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RotationEntry" ADD CONSTRAINT "RotationEntry_workoutTypeId_fkey" FOREIGN KEY ("workoutTypeId") REFERENCES "WorkoutType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutSession" ADD CONSTRAINT "WorkoutSession_rotationId_fkey" FOREIGN KEY ("rotationId") REFERENCES "WorkoutRotation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
