-- CreateTable
CREATE TABLE "OrderTotal" (
    "shopId" TEXT NOT NULL,
    "orderGid" TEXT NOT NULL,
    "totalMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "touched" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderTotal_pkey" PRIMARY KEY ("shopId","orderGid")
);

-- CreateIndex
CREATE INDEX "OrderTotal_shopId_createdAt_idx" ON "OrderTotal"("shopId", "createdAt");

-- AddForeignKey
ALTER TABLE "OrderTotal" ADD CONSTRAINT "OrderTotal_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

