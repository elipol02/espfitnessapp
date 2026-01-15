-- AlterTable: Change weightUsed from Float to Json array
-- Step 1: Add temporary column
ALTER TABLE "ExerciseLog" ADD COLUMN "weightUsedNew" JSONB;

-- Step 2: Populate new column with array of weights (repeating the single weight for each set)
DO $$
DECLARE
    rec RECORD;
    weight_array JSONB;
BEGIN
    FOR rec IN SELECT id, "weightUsed", "repsPerSet" FROM "ExerciseLog"
    LOOP
        -- Create an array with the same weight repeated for each set
        SELECT jsonb_agg(rec."weightUsed")
        INTO weight_array
        FROM generate_series(1, jsonb_array_length(rec."repsPerSet"));
        
        UPDATE "ExerciseLog"
        SET "weightUsedNew" = weight_array
        WHERE id = rec.id;
    END LOOP;
END $$;

-- Step 3: Drop old column
ALTER TABLE "ExerciseLog" DROP COLUMN "weightUsed";

-- Step 4: Rename new column
ALTER TABLE "ExerciseLog" RENAME COLUMN "weightUsedNew" TO "weightUsed";

-- Step 5: Set NOT NULL constraint
ALTER TABLE "ExerciseLog" ALTER COLUMN "weightUsed" SET NOT NULL;
