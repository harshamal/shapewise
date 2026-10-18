import { defineConfig } from "vitest/config";

// Next compiles JSX itself; tests need the automatic runtime spelled out.
export default defineConfig({ esbuild: { jsx: "automatic" } });
