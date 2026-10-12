import { config } from "@repo/eslint-config/base";

export default [
  ...config,
  {
    // Evals and test setup run directly, not as cached turbo tasks, so their
    // env vars (budgets, scripts, fake clock) don't affect turbo's cache.
    files: ["evals/**", "test/**"],
    rules: { "turbo/no-undeclared-env-vars": "off" },
  },
];
