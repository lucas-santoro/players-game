import { NextRequest, NextResponse } from 'next/server';
import { searchPlayers } from '@/lib/players';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q') ?? '';
  const results = await searchPlayers(q);
  return NextResponse.json({ results });
}
