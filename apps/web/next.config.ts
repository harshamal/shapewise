import type { NextConfig } from "next";

const config: NextConfig = {
  // Workspace packages ship TypeScript source, so Next compiles them.
  transpilePackages: ["@shapewise/blueprint", "@shapewise/runtime", "@shapewise/ui", "@shapewise/db", "@shapewise/ai"],
  // firebase-admin and its gRPC/HTTP stack stay as normal Node modules on the server.
  serverExternalPackages: ["firebase-admin", "@react-pdf/renderer"],
  typedRoutes: true,
};

export default config;
