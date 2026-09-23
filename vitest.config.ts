import path from "node:path";

import { defineConfig } from "vitest/config";

// Keep tests independent from vite.config.ts: the production config starts
// Nitro/Vite watchers and evaluates browser-targeted CommonJS SSR modules.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./app"),
      "@shared": path.resolve(__dirname, "./shared"),
    },
  },
  test: {
    globals: false,
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    include: [
      "tests/**/*.test.ts",
      "tests/**/*.spec.ts",
    ],
    exclude: [
      "**/node_modules/**",
      "**/.git/**",
      "**/dist/**",
      "**/.react-router/**",
      "**/.agents/**",
    ],
    // PGlite is single-connection per instance; parallel tests each get their
    // own DB instance. File-level concurrency is safe; test-level within a
    // file must be sequential (same instance shared via describe/afterAll).
    fileParallelism: true,
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
