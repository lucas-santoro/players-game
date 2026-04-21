import { NextRequest, NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  getDailyTargetId,
  getEnrichedPlayer,
  pickDailyTarget,
} from '@/lib/players';
import { computeScore } from '@/lib/scoring';

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
  return (await getDailyTargetId(date)) ?? playerId;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const playerId = Number(body?.playerId);
  if (!Number.isInteger(playerId) || playerId <= 0) {
    return NextResponse.json({ error: 'invalid playerId' }, { status: 400 });
  }

  const date = todayUtc();
  const targetId = await ensureDailyTarget(date);

  const [target, guess] = await Promise.all([
    getEnrichedPlayer(targetId),
    getEnrichedPlayer(playerId),
  ]);
  if (!target) return NextResponse.json({ error: 'no target' }, { status: 500 });
  if (!guess) return NextResponse.json({ error: 'unknown player' }, { status: 404 });

  const result = computeScore(target, guess);

  // Reveal target details ONLY on a correct guess.
  const targetDetails = result.isCorrect
    ? {
        id: target.id,
        name: target.name,
        photoUrl: target.photoUrl,
        currentClubName: target.currentClubName,
        currentLeagueName: target.currentLeagueName,
        countryOfCitizenshipName: target.countryOfCitizenshipName,
        primaryPosition: target.primaryPosition,
        dob: target.dob,
        marketValueEur: target.marketValueEur,
      }
    : undefined;

  return NextResponse.json({
    guess: {
      id: guess.id,
      name: guess.name,
      photoUrl: guess.photoUrl,
    },
    totalScore: result.totalScore,
    breakdown: result.breakdown,
    isCorrect: result.isCorrect,
    targetDetails,
  });
}
