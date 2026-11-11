import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  globalIgnores(["dist/", "test-results/", "playwright-report/"]),
  js.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    extends: tseslint.configs.recommended,
  },
  {
    files: ["src/sim/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "(^|/)(ui|lab)(/|$)|^react(-dom)?(/|$)",
              message:
                "Keep simulation dependencies independent of the UI and Lab.",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportExpression",
          message:
            "Use static imports in the engine so layer boundaries can be checked.",
        },
      ],
    },
  },
);
