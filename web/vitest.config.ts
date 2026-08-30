import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

// Reuses the app's own Vite config (react plugin, base: "./"), so tests see the
// same module resolution, the same import.meta.glob for the icon assets, and
// the same import.meta.env.BASE_URL that loadFont/loadProfile fetch against.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      include: ["tests/**/*.test.{ts,tsx}"],
      setupFiles: ["tests/setup.ts"],
      // Three.js, fflate and manifold all run headless; only the LabelForm test
      // needs a DOM, and it opts in with a per-file @vitest-environment docblock.
      environment: "node",
      testTimeout: 30_000,
    },
  }),
);
