/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    serverComponentsExternalPackages: ['postgres', 'ioredis', 'bullmq'],
  },
  // Emit a self-contained, file-traced server bundle under
  // .next/standalone/. Production runs `node standalone/server.js` and
  // never touches the full repo's node_modules, which removes the OOM
  // risk on the 1 GB VPS and makes deploys atomic — we ship the bundle,
  // not the source tree.
  //
  // Output layout to assemble on the server:
  //   /opt/dlr/standalone/server.js
  //   /opt/dlr/standalone/node_modules/       (pruned, from .next/standalone)
  //   /opt/dlr/standalone/.next/server/       (from .next/standalone/.next)
  //   /opt/dlr/standalone/.next/static/       (copied from .next/static)
  //   /opt/dlr/standalone/public/             (copied from public/)
  //   /opt/dlr/standalone/.env                (symlink to /opt/dlr/.env)
  output: 'standalone',
}

export default nextConfig
