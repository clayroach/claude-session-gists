import { defineConfig } from "vitest/config"

export default defineConfig({
  esbuild: {
    target: "es2022"
  },
  test: {
    include: ["src/test/**/*.test.ts"],
    globals: false,
    testTimeout: 30000,
    sequence: {
      concurrent: true
    }
  }
})
