import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Dev-only seed: one shop with a draft bundle, volume rule and upsell rule. Idempotent.
async function main() {
  const domain = process.env.SEED_SHOP_DOMAIN ?? "bundlekit-dev.myshopify.com";
  const shop = await prisma.shop.upsert({
    where: { domain },
    create: { domain, settings: { shippingBar: { thresholdMinor: "50000" } } },
    update: {},
  });
  if ((await prisma.bundle.count({ where: { shopId: shop.id } })) === 0) {
    await prisma.bundle.create({
      data: {
        shopId: shop.id,
        type: "FIXED",
        title: "Starter pair",
        discountType: "PERCENT",
        discountValue: "15",
        items: [
          { productGid: "gid://shopify/Product/1", quantity: 1 },
          { productGid: "gid://shopify/Product/2", quantity: 1 },
        ],
      },
    });
    await prisma.volumeRule.create({
      data: {
        shopId: shop.id,
        targetType: "PRODUCT",
        targetGids: ["gid://shopify/Product/1"],
        tiers: [
          { minQty: 2, percentOff: 10 },
          { minQty: 3, percentOff: 15 },
        ],
      },
    });
    await prisma.upsellRule.create({
      data: {
        shopId: shop.id,
        triggerType: "PRODUCT",
        triggerGids: ["gid://shopify/Product/1"],
        offerGids: ["gid://shopify/Product/2"],
      },
    });
  }
  console.log(`seeded ${domain}`);
}

main().finally(() => prisma.$disconnect());
