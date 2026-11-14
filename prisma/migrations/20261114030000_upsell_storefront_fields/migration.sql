-- AlterTable
ALTER TABLE "UpsellRule" ADD COLUMN     "layout" TEXT NOT NULL DEFAULT 'STACKED',
ADD COLUMN     "offerHandles" TEXT[] DEFAULT ARRAY[]::TEXT[];

