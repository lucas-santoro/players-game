import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@/drizzle/schema';

type Drizzle = ReturnType<typeof drizzle<typeof schema>>;

let cached: Drizzle | null = null;

function getDb(): Drizzle {
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  cached = drizzle(postgres(url, { prepare: false }), { schema });
  return cached;
}

export const db = new Proxy({} as Drizzle, {
  get(_target, prop, _receiver) {
    const real = getDb();
    return Reflect.get(real, prop, real);
  },
});

export type Db = Drizzle;
