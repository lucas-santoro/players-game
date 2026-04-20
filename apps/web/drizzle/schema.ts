import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  date,
  bigint,
  primaryKey,
  pgEnum,
  index,
  smallint,
} from 'drizzle-orm/pg-core';

export const continentEnum = pgEnum('continent', [
  'africa',
  'asia',
  'europe',
  'north_america',
  'oceania',
  'south_america',
]);

export const footEnum = pgEnum('foot', ['left', 'right', 'both', 'unknown']);

export const trophyScopeEnum = pgEnum('trophy_scope', [
  'uefa',
  'conmebol',
  'concacaf',
  'national',
  'world',
]);

export const countries = pgTable('countries', {
  id: serial('id').primaryKey(),
  tmId: text('tm_id').unique(),
  name: text('name').notNull().unique(),
  continent: continentEnum('continent').notNull(),
});

export const leagues = pgTable('leagues', {
  id: serial('id').primaryKey(),
  tmId: text('tm_id').unique(),
  name: text('name').notNull(),
  countryId: integer('country_id').references(() => countries.id),
  tier: smallint('tier').notNull().default(1),
  isTop5European: boolean('is_top5_european').notNull().default(false),
});

export const clubs = pgTable(
  'clubs',
  {
    id: serial('id').primaryKey(),
    tmId: integer('tm_id').unique(),
    name: text('name').notNull(),
    leagueId: integer('league_id').references(() => leagues.id),
    countryId: integer('country_id').references(() => countries.id),
  },
  (t) => ({
    leagueIdx: index('clubs_league_idx').on(t.leagueId),
  }),
);

export const players = pgTable(
  'players',
  {
    id: serial('id').primaryKey(),
    tmId: integer('tm_id').unique(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    dob: date('dob'),
    heightCm: smallint('height_cm'),
    foot: footEnum('foot').notNull().default('unknown'),
    primaryPosition: text('primary_position'),
    genericPosition: text('generic_position'),
    currentClubId: integer('current_club_id').references(() => clubs.id),
    currentJerseyNumber: smallint('current_jersey_number'),
    marketValueEur: bigint('market_value_eur', { mode: 'number' }),
    countryOfCitizenshipId: integer('country_of_citizenship_id').references(() => countries.id),
    countryOfBirthId: integer('country_of_birth_id').references(() => countries.id),
    isActive: boolean('is_active').notNull().default(true),
    lastSeason: smallint('last_season'),
    photoUrl: text('photo_url'),
  },
  (t) => ({
    nameIdx: index('players_name_idx').on(t.name),
    slugIdx: index('players_slug_idx').on(t.slug),
    clubIdx: index('players_club_idx').on(t.currentClubId),
    activeIdx: index('players_active_idx').on(t.isActive),
    citizenshipIdx: index('players_citizenship_idx').on(t.countryOfCitizenshipId),
  }),
);

export const transfers = pgTable(
  'transfers',
  {
    id: serial('id').primaryKey(),
    playerId: integer('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    fromClubId: integer('from_club_id').references(() => clubs.id),
    toClubId: integer('to_club_id').references(() => clubs.id),
    season: smallint('season').notNull(),
    transferDate: date('transfer_date'),
    feeEur: bigint('fee_eur', { mode: 'number' }),
    marketValueEur: bigint('market_value_eur', { mode: 'number' }),
  },
  (t) => ({
    playerIdx: index('transfers_player_idx').on(t.playerId),
    fromIdx: index('transfers_from_club_idx').on(t.fromClubId),
    toIdx: index('transfers_to_club_idx').on(t.toClubId),
    seasonIdx: index('transfers_season_idx').on(t.season),
  }),
);

export const playerTeammates = pgTable(
  'player_teammates',
  {
    playerAId: integer('player_a_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    playerBId: integer('player_b_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    seasonsOverlapped: smallint('seasons_overlapped').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.playerAId, t.playerBId] }),
    bIdx: index('teammates_b_idx').on(t.playerBId),
  }),
);

export const trophies = pgTable('trophies', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  scope: trophyScopeEnum('scope').notNull(),
});

export const playerTrophies = pgTable(
  'player_trophies',
  {
    playerId: integer('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    trophyId: integer('trophy_id')
      .notNull()
      .references(() => trophies.id),
    year: smallint('year').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.playerId, t.trophyId, t.year] }),
  }),
);

export const dailyTargets = pgTable('daily_targets', {
  date: date('date').primaryKey(),
  playerId: integer('player_id')
    .notNull()
    .references(() => players.id),
});
