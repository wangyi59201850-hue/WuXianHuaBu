import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: __dirname,
  },
  // Next.js 16 blocks dev assets from cross-origin hosts by default.
  // Permit local hosts used by this project for H5/electron debugging.
  allowedDevOrigins: ["127.0.0.1", "localhost", "192.168.30.43"],
  devIndicators: false,
};

export default nextConfig;
