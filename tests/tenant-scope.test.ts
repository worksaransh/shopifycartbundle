import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Tenant isolation guard: every Prisma call on a shop-owned table must mention `shopId` in its arguments
 * (a where filter, a composite key like shopId_orderGid, or data.shopId on create). A new query without it fails CI.
 * This is a static check over the source AST, so it also catches routes that forget the scope.
 */
const TENANT_MODELS = new Set([
  "bundle",
  "volumeRule",
  "upsellRule",
  "eventDaily",
  "orderAttribution",
  "orderTotal",
]);
const ROOT = path.resolve(__dirname, "../app");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(p) ? [p] : [];
  });
}

interface Call {
  file: string;
  model: string;
  op: string;
  args: string;
  line: number;
}

function tenantCalls(): Call[] {
  const out: Call[] = [];
  for (const file of files(ROOT)) {
    const src = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
        const op = n.expression.name.text;
        const target = n.expression.expression;
        if (
          ts.isPropertyAccessExpression(target) &&
          ts.isIdentifier(target.expression) &&
          target.expression.text === "db" &&
          TENANT_MODELS.has(target.name.text)
        ) {
          out.push({
            file: path.relative(ROOT, file),
            model: target.name.text,
            op,
            args: n.arguments.map((a) => a.getText()).join(","),
            line: src.getLineAndCharacterOfPosition(n.getStart()).line + 1,
          });
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(src);
  }
  return out;
}

describe("tenant scope", () => {
  const calls = tenantCalls();
  it("finds the queries it is supposed to guard (the check itself is working)", () => {
    expect(calls.length).toBeGreaterThan(15);
    expect(new Set(calls.map((c) => c.model))).toEqual(TENANT_MODELS);
  });
  it("every query on a shop-owned table is scoped by shopId", () => {
    const unscoped = calls.filter((c) => !/\bshopId\b|shopId_/.test(c.args));
    expect(unscoped.map((c) => `${c.file}:${c.line} db.${c.model}.${c.op}`)).toEqual([]);
  });
});
