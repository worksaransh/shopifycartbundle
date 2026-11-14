-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "BundleType" AS ENUM ('FIXED', 'MIX_MATCH');

-- CreateEnum
CREATE TYPE "RuleStatus" AS ENUM ('ACTIVE', 'PAUSED', 'DRAFT');

-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('PERCENT', 'AMOUNT', 'FIXED_PRICE');

-- CreateEnum
CREATE TYPE "TargetType" AS ENUM ('PRODUCT', 'COLLECTION');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('BUNDLE_VIEWED', 'BUNDLE_ADDED', 'UPSELL_VIEWED', 'UPSELL_ADDED', 'TIER_SELECTED', 'SHIPPING_BAR_COMPLETED', 'CART_SURFACE_MISSING');

-- CreateEnum
CREATE TYPE "AttributionSource" AS ENUM ('BUNDLE', 'VOLUME', 'UPSELL');

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" TIMESTAMP(3),
    "settings" JSONB NOT NULL DEFAULT '{}',
    "metafieldSyncedAt" TIMESTAMP(3),

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bundle" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "type" "BundleType" NOT NULL,
    "title" TEXT NOT NULL,
    "status" "RuleStatus" NOT NULL DEFAULT 'DRAFT',
    "discountType" "DiscountType" NOT NULL,
    "discountValue" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "discountGid" TEXT,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bundle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VolumeRule" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "targetType" "TargetType" NOT NULL,
    "targetGids" TEXT[],
    "tiers" JSONB NOT NULL,
    "status" "RuleStatus" NOT NULL DEFAULT 'DRAFT',
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VolumeRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UpsellRule" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "triggerType" "TargetType" NOT NULL,
    "triggerGids" TEXT[],
    "offerGids" TEXT[],
    "discountPercent" INTEGER,
    "maxOffers" INTEGER NOT NULL DEFAULT 3,
    "hideIfInCart" BOOLEAN NOT NULL DEFAULT true,
    "status" "RuleStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UpsellRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventDaily" (
    "shopId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "eventType" "EventType" NOT NULL,
    "refId" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "EventDaily_pkey" PRIMARY KEY ("shopId","date","eventType","refId")
);

-- CreateTable
CREATE TABLE "OrderAttribution" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "orderGid" TEXT NOT NULL,
    "source" "AttributionSource" NOT NULL,
    "refId" TEXT NOT NULL,
    "revenueMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderAttribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookReceipt" (
    "id" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Session_shop_idx" ON "Session"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "Shop_domain_key" ON "Shop"("domain");

-- CreateIndex
CREATE INDEX "Bundle_shopId_status_idx" ON "Bundle"("shopId", "status");

-- CreateIndex
CREATE INDEX "VolumeRule_shopId_status_idx" ON "VolumeRule"("shopId", "status");

-- CreateIndex
CREATE INDEX "UpsellRule_shopId_status_idx" ON "UpsellRule"("shopId", "status");

-- CreateIndex
CREATE INDEX "OrderAttribution_shopId_createdAt_idx" ON "OrderAttribution"("shopId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OrderAttribution_shopId_orderGid_source_refId_key" ON "OrderAttribution"("shopId", "orderGid", "source", "refId");

-- CreateIndex
CREATE INDEX "WebhookReceipt_shopDomain_idx" ON "WebhookReceipt"("shopDomain");

-- CreateIndex
CREATE INDEX "WebhookReceipt_receivedAt_idx" ON "WebhookReceipt"("receivedAt");

-- AddForeignKey
ALTER TABLE "Bundle" ADD CONSTRAINT "Bundle_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VolumeRule" ADD CONSTRAINT "VolumeRule_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpsellRule" ADD CONSTRAINT "UpsellRule_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventDaily" ADD CONSTRAINT "EventDaily_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderAttribution" ADD CONSTRAINT "OrderAttribution_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

