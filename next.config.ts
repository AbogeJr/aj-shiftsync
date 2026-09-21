import type { NextConfig } from 'next'
import { fileURLToPath } from 'node:url'

// Deployed to Railway as a single long-running Node service via `next start`.
// Deliberately NOT using output: 'standalone'.
const nextConfig: NextConfig = {
  turbopack: {
    // Pin the workspace root. Without this, Next walks up the tree and can
    // select an unrelated lockfile in a parent directory as the root.
    root: fileURLToPath(new URL('.', import.meta.url)),
  },
}

export default nextConfig
