import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    // These tests change the working directory, which worker threads can't do.
    poolMatchGlobs: [["**/all-prompts.test.ts", "forks"]],
  },
});
