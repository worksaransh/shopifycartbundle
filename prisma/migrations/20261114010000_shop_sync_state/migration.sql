-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('IDLE', 'SYNCING', 'SYNCED', 'FAILED');

-- AlterTable
ALTER TABLE "Shop" ADD COLUMN     "syncError" TEXT,
ADD COLUMN     "syncStatus" "SyncStatus" NOT NULL DEFAULT 'IDLE',
ADD COLUMN     "syncedProductGids" TEXT[] DEFAULT ARRAY[]::TEXT[];

