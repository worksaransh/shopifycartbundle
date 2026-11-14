// NOTE: "$app:bundlekit" resolves to the app-reserved namespace for the calling app.
// metafieldsDelete input type verified against the 2026-10 schema (MetafieldIdentifierInput).
// These documents were NOT machine-validated (validator unavailable); the first run on a dev store must confirm them.
import { NAMESPACE } from "@bundlekit/config-schema";

export const SHOP_ID = `#graphql
  query ShopId { shop { id } }`;

export const SET_METAFIELDS = `#graphql
  mutation SetMetafields($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { key namespace }
      userErrors { field message code }
    }
  }`;

export const DELETE_METAFIELDS = `#graphql
  mutation DeleteMetafields($metafields: [MetafieldIdentifierInput!]!) {
    metafieldsDelete(metafields: $metafields) {
      deletedMetafields { key namespace ownerId }
      userErrors { field message }
    }
  }`;

export const COLLECTION_PRODUCTS = `#graphql
  query CollectionProducts($id: ID!, $after: String) {
    collection(id: $id) {
      products(first: 250, after: $after) {
        nodes { id }
        pageInfo { hasNextPage endCursor }
      }
    }
  }`;

export const READ_SHOP_CONFIG = `#graphql
  query ReadShopConfig {
    shop { id config: metafield(namespace: "${NAMESPACE}", key: "config") { value } }
  }`;

export const READ_PRODUCT_METAFIELDS = `#graphql
  query ReadProductMetafields($ids: [ID!]!) {
    nodes(ids: $ids) {
      __typename
      ... on Product {
        id
        bundles: metafield(namespace: "${NAMESPACE}", key: "bundles") { value }
        volume: metafield(namespace: "${NAMESPACE}", key: "volume") { value }
      }
    }
  }`;
