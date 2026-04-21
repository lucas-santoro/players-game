import { NextRequest, NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { pickDailyTarget } from '@/lib/players';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const provided =
      req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
      req.nextUrl.searchParams.get('secret');
    if (provided !== expected) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  const date = new Date().toISOString().slice(0, 10);
  const playerId = await pickDailyTarget(date);

  await db.execute(sql`
    INSERT INTO daily_targets (date, player_id)
    VALUES (${date}::date, ${playerId})
    ON CONFLICT (date) DO UPDATE SET player_id = EXCLUDED.player_id
  `);

  return NextResponse.json({ date, playerId });
}
