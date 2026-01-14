-- AlterTable
ALTER TABLE "Exercise" ADD COLUMN     "distance" DOUBLE PRECISION,
ADD COLUMN     "distanceUnit" TEXT DEFAULT 'feet',
ADD COLUMN     "intervals" JSONB,
ADD COLUMN     "tempo" TEXT,
ADD COLUMN     "timeCap" INTEGER;
