import { ESLint } from "eslint";
import { expect, it } from "vitest";

const eslint = new ESLint();
const engine = { filePath: "src/sim/agent/planner.ts" };
// Load the TypeScript parser once before timing individual boundary checks.
await eslint.calculateConfigForFile(engine.filePath);

it.each([
  'import "../../ui/viewport";',
  'export * from "../../lab/runner";',
  'import type { ReactNode } from "react"; export type Label = ReactNode;',
  'import "react-dom/client";',
])(
  "rejects a static dependency across the engine boundary: %s",
  async (code) => {
    const [result] = await eslint.lintText(code, engine);
    expect(result?.messages.map((message) => message.ruleId)).toContain(
      "no-restricted-imports",
    );
  },
);

it("rejects deferred loading that bypasses the static boundary", async () => {
  const [result] = await eslint.lintText(
    'import("../../ui/viewport");',
    engine,
  );
  expect(result?.messages.map((message) => message.ruleId)).toContain(
    "no-restricted-syntax",
  );
});

it("permits engine-local imports and UI consumers of the engine", async () => {
  const [local] = await eslint.lintText(
    'export * from "../graph/edges";',
    engine,
  );
  const [consumer] = await eslint.lintText(
    'import "../sim/engine"; import "react";',
    {
      filePath: "src/ui/viewport.ts",
    },
  );
  expect(local?.messages).toEqual([]);
  expect(consumer?.messages).toEqual([]);
});
