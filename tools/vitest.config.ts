import { defineConfig } from "vitest/config";

// Coverage of the core logic: the plain TypeScript in Assets/Scripts/Core that computes every line on the floor.
// The same files run in the Lens and in these tests.
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      allowExternal: true,
      include: ["**/Scripts/Core/**/*.ts"],
      reporter: ["text", "json-summary"],
      thresholds: { lines: 85 },
    },
  },
});
