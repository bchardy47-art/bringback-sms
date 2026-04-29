// pm2 process configuration for DLR
// Used by bootstrap.sh to start and manage app + worker
module.exports = {
  apps: [
    {
      name: 'dlr-app',
      script: 'node_modules/.bin/next',
      args: 'start',
      cwd: '/opt/dlr',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
    },
    {
      name: 'dlr-worker',
      script: 'node_modules/.bin/tsx',
      args: 'worker.ts',
      cwd: '/opt/dlr',
      env: {
        NODE_ENV: 'production',
      },
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
    },
  ],
}
