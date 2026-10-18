/** @type {import('next').NextConfig} */
const config = {
  // Workspace packages ship TypeScript source, so Next compiles them.
  transpilePackages: ["@shapewise/blueprint", "@shapewise/runtime", "@shapewise/ui", "@shapewise/db", "@shapewise/ai"],
  serverExternalPackages: ["firebase-admin", "@react-pdf/renderer"],
  typedRoutes: true,
  webpack: (config) => {
    return config;
  },
};

module.exports = config;
