-- CreateTable
CREATE TABLE "ChatMemory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMemory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChatMemory_userId_idx" ON "ChatMemory"("userId");

-- CreateIndex
CREATE INDEX "ChatMemory_sessionId_idx" ON "ChatMemory"("sessionId");

-- CreateIndex
CREATE INDEX "ChatMemory_createdAt_idx" ON "ChatMemory"("createdAt");

-- AddForeignKey
ALTER TABLE "ChatMemory" ADD CONSTRAINT "ChatMemory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
