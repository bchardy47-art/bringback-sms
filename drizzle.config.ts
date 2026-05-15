import { defineConfig } from 'drizzle-kit'

// Migrations live in `./migrations/` — see MIGRATIONS.md. The historic `drizzle/`
// directory (output from earlier `drizzle-kit generate` runs) is retained but
// no longer the active output directory.
export default defineConfig({
  schema: './src/lib/db/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
})
