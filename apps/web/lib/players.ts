import { sql } from 'drizzle-orm';
import { db } from './db';
import type { EnrichedPlayer } from './scoring';

const ENRICHED_SELECT = sql`
  SELECT
    p.id,
    p.tm_id              AS "tmId",
    p.name,
    p.slug,
    p.dob::text          AS dob,
    p.height_cm          AS "heightCm",
    p.foot,
    p.primary_position   AS "primaryPosition",
    p.generic_position   AS "genericPosition",
    p.current_club_id    AS "currentClubId",
    cc.name              AS "currentClubName",
    cc.league_id         AS "currentLeagueId",
    cl.name              AS "currentLeagueName",
    p.country_of_citizenship_id AS "countryOfCitizenshipId",
    cit.name             AS "countryOfCitizenshipName",
    cit.continent::text  AS "citizenshipContinent",
    p.country_of_birth_id AS "countryOfBirthId",
    bir.name             AS "countryOfBirthName",
    bir.continent::text  AS "birthContinent",
    p.market_value_eur   AS "marketValueEur",
    p.last_season        AS "lastSeason",
    p.is_active          AS "isActive",
    p.photo_url          AS "photoUrl"
  FROM players p
  LEFT JOIN clubs cc      ON cc.id  = p.current_club_id
  LEFT JOIN leagues cl    ON cl.id  = cc.league_id
  LEFT JOIN countries cit ON cit.id = p.country_of_citizenship_id
  LEFT JOIN countries bir ON bir.id = p.country_of_birth_id
`;

export async function getEnrichedPlayer(id: number): Promise<EnrichedPlayer | null> {
  const result = await db.execute<EnrichedPlayer>(
    sql`${ENRICHED_SELECT} WHERE p.id = ${id} LIMIT 1`,
  );
  return (result[0] as EnrichedPlayer) ?? null;
}

export async function getEnrichedPlayerByTmId(
  tmId: number,
): Promise<EnrichedPlayer | null> {
  const result = await db.execute<EnrichedPlayer>(
    sql`${ENRICHED_SELECT} WHERE p.tm_id = ${tmId} LIMIT 1`,
  );
  return (result[0] as EnrichedPlayer) ?? null;
}

export type PlayerSearchResult = {
  id: number;
  name: string;
  currentClubName: string | null;
  citizenship: string | null;
  photoUrl: string | null;
};

export async function searchPlayers(
  query: string,
  limit = 20,
): Promise<PlayerSearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 1) return [];

  const contains = '%' + trimmed + '%';
  const prefix = trimmed + '%';

  // unaccent() makes "Pele" match "Pelé" and vice-versa.
  // The extension is created by an idempotent migration step at startup.
  const result = await db.execute<PlayerSearchResult>(sql`
    SELECT
      p.id,
      p.name,
      cc.name AS "currentClubName",
      cit.name AS citizenship,
      p.photo_url AS "photoUrl"
    FROM players p
    LEFT JOIN clubs cc      ON cc.id  = p.current_club_id
    LEFT JOIN countries cit ON cit.id = p.country_of_citizenship_id
    WHERE unaccent(p.name) ILIKE unaccent(${contains})
    ORDER BY
      (unaccent(p.name) ILIKE unaccent(${prefix})) DESC,
      p.is_active DESC,
      p.market_value_eur DESC NULLS LAST,
      p.name
    LIMIT ${limit}
  `);
  return result as PlayerSearchResult[];
}

export async function getDailyTargetId(date: string): Promise<number | null> {
  const result = await db.execute<{ playerId: number }>(sql`
    SELECT player_id AS "playerId" FROM daily_targets WHERE date = ${date}::date
  `);
  return (result[0] as { playerId: number } | undefined)?.playerId ?? null;
}

/** Pick a deterministic daily target from the active top-5 European pool. */
export async function pickDailyTarget(date: string): Promise<number> {
  // FNV-1a hash of the date string -> deterministic offset into the pool.
  let hash = 2166136261;
  for (let i = 0; i < date.length; i++) {
    hash ^= date.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  const result = await db.execute<{ id: number; total: number }>(sql`
    WITH pool AS (
      SELECT p.id
      FROM players p
      JOIN clubs c ON c.id = p.current_club_id
      JOIN leagues l ON l.id = c.league_id
      WHERE p.is_active AND l.is_top5_european
        AND p.market_value_eur IS NOT NULL
        AND p.market_value_eur >= 5000000
      ORDER BY p.id
    ),
    counted AS (SELECT count(*)::int AS total FROM pool)
    SELECT (
      SELECT id FROM pool OFFSET ${hash} % (SELECT total FROM counted) LIMIT 1
    ) AS id, (SELECT total FROM counted) AS total
  `);
  const row = result[0] as { id: number; total: number };
  if (!row?.id) {
    throw new Error('Empty target pool — no active players in top-5 leagues');
  }
  return row.id;
}
