import { type VercelConfig } from '@vercel/config/v1';

export const config: VercelConfig = {
  framework: 'nextjs',
  buildCommand: 'pnpm --filter web build',
  installCommand: 'pnpm install --frozen-lockfile',
  outputDirectory: 'apps/web/.next',
  crons: [
    {
      path: '/api/cron/select-daily',
      schedule: '0 0 * * *',
    },
  ],
};
