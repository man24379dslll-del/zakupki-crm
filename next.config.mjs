// Конфиг на JS, а не TS: после npm prune в образе нет typescript, и Next.js докачивал бы его при каждом запуске
/** @type {import("next").NextConfig} */
const config = {
  serverExternalPackages: ["exceljs", "pg", "bcryptjs"],
  experimental: { serverActions: { bodySizeLimit: "25mb" } },
  poweredByHeader: false,
};
export default config;
