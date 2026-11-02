import type { NextConfig } from "next";
const config: NextConfig = {
  serverExternalPackages: ["exceljs", "pg", "bcryptjs"],
  experimental: { serverActions: { bodySizeLimit: "25mb" } },
  poweredByHeader: false,
};
export default config;
