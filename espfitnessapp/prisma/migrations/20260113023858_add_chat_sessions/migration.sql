/*
  Warnings:

  - Added the required column `sessionId` to the `ChatMessage` table without a default value. This is not possible if the table is not empty.

*/

-- CreateTable: Create ChatSession table
CREATE TABLE "ChatSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChatSession_userId_idx" ON "ChatSession"("userId");

-- CreateIndex
CREATE INDEX "ChatSession_createdAt_idx" ON "ChatSession"("createdAt");

-- AddForeignKey
ALTER TABLE "ChatSession" ADD CONSTRAINT "ChatSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Create a default session for each user with existing chat messages
INSERT INTO "ChatSession" ("id", "userId", "title", "createdAt", "updatedAt")
SELECT 
    gen_random_uuid()::text,
    "userId",
    'Legacy Chat',
    MIN("createdAt"),
    MAX("createdAt")
FROM "ChatMessage"
GROUP BY "userId";

-- AlterTable: Add sessionId column (nullable first)
ALTER TABLE "ChatMessage" ADD COLUMN "sessionId" TEXT;

-- Update existing messages to use the default session
UPDATE "ChatMessage" cm
SET "sessionId" = cs.id
FROM "ChatSession" cs
WHERE cm."userId" = cs."userId";

-- Make sessionId NOT NULL
ALTER TABLE "ChatMessage" ALTER COLUMN "sessionId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "ChatMessage_sessionId_idx" ON "ChatMessage"("sessionId");

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ChatSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
