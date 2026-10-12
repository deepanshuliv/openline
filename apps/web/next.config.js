import path from "node:path";
import { fileURLToPath } from "node:url";

const monorepoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** @type {import('next').NextConfig} */
const nextConfig = {
  // lib/shared.ts imports packages/shared sources, which sit outside apps/web.
  turbopack: { root: monorepoRoot },
  agentRules: false,
};

export default nextConfig;
