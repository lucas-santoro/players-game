import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { getDailyTargetId, pickDailyTarget } from '@/lib/players';

export const dynamic = 'force-dynamic';

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

async function ensureDailyTarget(date: string): Promise<number> {
  const existing = await getDailyTargetId(date);
  if (existing) return existing;

  const playerId = await pickDailyTarget(date);
  await db.execute(sql`
    INSERT INTO daily_targets (date, player_id)
    VALUES (${date}::date, ${playerId})
    ON CONFLICT (date) DO NOTHING
  `);
  return playerId;
}

export async function GET() {
  const date = todayUtc();
  await ensureDailyTarget(date);
  return NextResponse.json({ date });
}
