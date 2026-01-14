-- AlterTable
ALTER TABLE "WorkoutDay" ADD COLUMN     "isGenerated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "scheduledDate" TIMESTAMP(3),
ADD COLUMN     "weekNumber" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "WorkoutPlan" ADD COLUMN     "startDate" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PendingAdjustment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "workoutLogId" TEXT NOT NULL,
    "suggestions" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PendingAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PendingAdjustment_workoutLogId_key" ON "PendingAdjustment"("workoutLogId");

-- CreateIndex
CREATE INDEX "PendingAdjustment_userId_idx" ON "PendingAdjustment"("userId");

-- CreateIndex
CREATE INDEX "PendingAdjustment_workoutLogId_idx" ON "PendingAdjustment"("workoutLogId");

-- CreateIndex
CREATE INDEX "PendingAdjustment_status_idx" ON "PendingAdjustment"("status");

-- CreateIndex
CREATE INDEX "WorkoutDay_scheduledDate_idx" ON "WorkoutDay"("scheduledDate");

-- CreateIndex
CREATE INDEX "WorkoutDay_workoutType_idx" ON "WorkoutDay"("workoutType");

-- CreateIndex
CREATE INDEX "WorkoutDay_planId_workoutType_scheduledDate_idx" ON "WorkoutDay"("planId", "workoutType", "scheduledDate");

-- AddForeignKey
ALTER TABLE "PendingAdjustment" ADD CONSTRAINT "PendingAdjustment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingAdjustment" ADD CONSTRAINT "PendingAdjustment_planId_fkey" FOREIGN KEY ("planId") REFERENCES "WorkoutPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
