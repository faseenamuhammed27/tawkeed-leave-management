/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    globals: true,
    css: false,
    // Keep worker count low: jsdom start-up is heavy on small CI runners and laptops.
    pool: "threads",
    maxWorkers: 2,
    isolate: false, // reuse workers across files (state is reset in src/test/setup.ts)
    testTimeout: 15000,
    coverage: {
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/test/**", "src/main.tsx", "src/**/*.d.ts"],
    },
  },
});
