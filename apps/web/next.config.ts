import type { NextConfig } from "next";

const config: NextConfig = {
  // Workspace packages ship TypeScript source, so Next compiles them.
  transpilePackages: ["@shapewise/blueprint", "@shapewise/runtime", "@shapewise/ui"],
  typedRoutes: true,
};

export default config;
