// pm2 process configuration for DLR.
// This is the canonical tracked copy; production runs from
// /opt/dlr/ecosystem.config.js which the deploy bootstrap rsyncs from here.
module.exports = {
  apps: [
    {
      name: 'dlr-web',
      // Runs the self-contained Next standalone bundle produced by
      // `next build` (with output:'standalone' in next.config.mjs). The
      // bundle is rsync'd to /opt/dlr/standalone by deploy_standalone.command.
      //
      // Why standalone over `next start`:
      //   - No reliance on the full repo node_modules at runtime — Stripe,
      //     drizzle, etc. are file-traced into the bundle.
      //   - Avoids OOM on the 1 GB VPS during deploys, because we never
      //     run `next build` on the server.
      //   - Atomic-ish swap: ship a new /opt/dlr/standalone tree, restart.
      script: 'server.js',
      cwd: '/opt/dlr/standalone',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      // Heap cap: standalone runtime is leaner than `next start`, but the
      // VPS still has 961 MiB total. Keep the same belt-and-suspenders
      // restart-on-RSS policy that converts slow swap-thrash into a clean
      // restart (= less 503 risk).
      max_memory_restart: '500M',
      node_args: ['--max-old-space-size=400'],
      max_restarts: 10,
      restart_delay: 3000,
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        // Bind to all interfaces; Caddy reverse-proxies localhost:3000 in.
        HOSTNAME: '0.0.0.0',
      },
    },
    {
      // The BullMQ worker still runs from the full source tree under
      // /opt/dlr (tsx compiles worker.ts on demand). The standalone
      // change only affects the web process.
      name: 'dlr-worker',
      script: 'node_modules/.bin/tsx',
      args: 'worker.ts',
      exec_mode: 'fork',
      cwd: '/opt/dlr',
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
}
