-- First, remove any duplicate workout logs (keep the earliest one for each user/day/date combination)
WITH duplicates AS (
  SELECT 
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "userId", "dayId", DATE("workoutDate")
      ORDER BY "createdAt" ASC
    ) as row_num
  FROM "WorkoutLog"
)
DELETE FROM "WorkoutLog"
WHERE id IN (
  SELECT id FROM duplicates WHERE row_num > 1
);

-- Add a unique index to prevent future duplicates
-- This ensures one workout log per user per day per date
CREATE UNIQUE INDEX "WorkoutLog_userId_dayId_date_unique" 
ON "WorkoutLog"("userId", "dayId", (DATE("workoutDate")));
