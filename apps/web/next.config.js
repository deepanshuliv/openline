/** @type {import('next').NextConfig} */
const nextConfig = {
  // Don't let Next.js auto-generate AGENTS.md/CLAUDE.md — this repo already has its own.
  agentRules: false,
};

export default nextConfig;
