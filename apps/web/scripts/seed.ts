import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '@/drizzle/schema';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

const client = postgres(url, { prepare: false });
const db = drizzle(client, { schema });

async function main() {
  console.log('Seeding minimal fake players...');

  const [brazil, spain, argentina] = await db
    .insert(schema.countries)
    .values([
      { name: 'Brazil', continent: 'south_america' },
      { name: 'Spain', continent: 'europe' },
      { name: 'Argentina', continent: 'south_america' },
    ])
    .onConflictDoNothing()
    .returning();

  const [laliga, brasileirao] = await db
    .insert(schema.leagues)
    .values([
      { name: 'LaLiga', countryId: spain?.id, tier: 1, isTop5European: true },
      { name: 'Brasileirão Série A', countryId: brazil?.id, tier: 1 },
    ])
    .onConflictDoNothing()
    .returning();

  const [barca, flamengo] = await db
    .insert(schema.clubs)
    .values([
      { name: 'FC Barcelona', leagueId: laliga?.id, countryId: spain?.id },
      { name: 'Flamengo', leagueId: brasileirao?.id, countryId: brazil?.id },
    ])
    .onConflictDoNothing()
    .returning();

  await db
    .insert(schema.players)
    .values([
      {
        name: 'Lamine Yamal',
        slug: 'lamine-yamal',
        dob: '2007-07-13',
        heightCm: 180,
        foot: 'left',
        primaryPosition: 'RW',
        genericPosition: 'FWD',
        currentClubId: barca?.id,
        currentJerseyNumber: 19,
        countryOfCitizenshipId: spain?.id,
        countryOfBirthId: spain?.id,
        marketValueEur: 200_000_000,
      },
      {
        name: 'Raphinha',
        slug: 'raphinha',
        dob: '1996-12-14',
        heightCm: 176,
        foot: 'right',
        primaryPosition: 'LW',
        genericPosition: 'FWD',
        currentClubId: barca?.id,
        currentJerseyNumber: 11,
        countryOfCitizenshipId: brazil?.id,
        countryOfBirthId: brazil?.id,
        marketValueEur: 90_000_000,
      },
      {
        name: 'Pelé',
        slug: 'pele',
        dob: '1940-10-23',
        heightCm: 173,
        foot: 'right',
        primaryPosition: 'CF',
        genericPosition: 'FWD',
        countryOfCitizenshipId: brazil?.id,
        countryOfBirthId: brazil?.id,
        isActive: false,
      },
    ])
    .onConflictDoNothing();

  console.log('Done.');
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
