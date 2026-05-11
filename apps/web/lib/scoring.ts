export type AttributeKey =
  | 'sameCurrentClub'
  | 'wereTeammates'
  | 'sameNationalTeam'
  | 'sameSpecificPosition'
  | 'sameBirthCountry'
  | 'sameCurrentLeague'
  | 'sameRetired'
  | 'sameGenericPosition'
  | 'sharedTrophy'
  | 'sameContinent'
  | 'sameAge'
  | 'sameHeightCm'
  | 'sameJerseyNumber'
  | 'sameFoot';

export const ATTRIBUTE_WEIGHTS: Record<AttributeKey, number> = {
  sameCurrentClub: 1000,
  wereTeammates: 500,
  sameNationalTeam: 400,
  sameSpecificPosition: 300,
  sameBirthCountry: 250,
  sameCurrentLeague: 200,
  sameRetired: 200,
  sameGenericPosition: 150,
  sharedTrophy: 150,
  sameContinent: 100,
  sameAge: 100,
  sameHeightCm: 50,
  sameJerseyNumber: 40,
  sameFoot: 30,
};

export const MAX_TOTAL_SCORE = Object.values(ATTRIBUTE_WEIGHTS).reduce(
  (a, b) => a + b,
  0,
);

export type Hint = 'higher' | 'lower' | null;

export type AttrCell = {
  matched: boolean;
  weight: number;
  guessValue: string | null;
  /** For numeric attrs: where the TARGET sits relative to the GUESS. */
  hint: Hint;
};

export type Breakdown = Record<AttributeKey, AttrCell>;

export type GuessResult = {
  totalScore: number;
  breakdown: Breakdown;
  isCorrect: boolean;
};

export type EnrichedPlayer = {
  id: number;
  tmId: number | null;
  name: string;
  slug: string;
  dob: string | null;
  heightCm: number | null;
  foot: 'left' | 'right' | 'both' | 'unknown';
  primaryPosition: string | null;
  genericPosition: string | null;
  currentClubId: number | null;
  currentClubName: string | null;
  currentLeagueId: number | null;
  currentLeagueName: string | null;
  countryOfCitizenshipId: number | null;
  countryOfCitizenshipName: string | null;
  citizenshipContinent: string | null;
  countryOfBirthId: number | null;
  countryOfBirthName: string | null;
  birthContinent: string | null;
  marketValueEur: number | null;
  lastSeason: number | null;
  isActive: boolean;
  photoUrl: string | null;
};

function ageYears(dob: string | null, today: Date = new Date()): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (isNaN(d.getTime())) return null;
  let age = today.getFullYear() - d.getFullYear();
  const m = today.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age--;
  return age;
}

function bothMatch<T>(a: T | null | undefined, b: T | null | undefined): boolean {
  return a !== null && a !== undefined && a === b;
}

function continentLabel(c: string | null): string | null {
  if (!c) return null;
  return (
    {
      africa: 'África',
      asia: 'Ásia',
      europe: 'Europa',
      north_america: 'América do Norte',
      oceania: 'Oceania',
      south_america: 'América do Sul',
    } as Record<string, string>
  )[c] ?? c;
}

function footLabel(f: string): string | null {
  if (f === 'unknown') return null;
  return (
    { left: 'Canhoto', right: 'Destro', both: 'Ambidestro' } as Record<string, string>
  )[f] ?? f;
}

function numericHint(target: number | null, guess: number | null): Hint {
  if (target === null || guess === null || target === guess) return null;
  return target > guess ? 'higher' : 'lower';
}

export function computeScore(
  target: EnrichedPlayer,
  guess: EnrichedPlayer,
  opts: { wereTeammates?: boolean; sharedTrophy?: boolean } = {},
): GuessResult {
  const targetAge = ageYears(target.dob);
  const guessAge = ageYears(guess.dob);

  const cells: Record<AttributeKey, AttrCell> = {
    sameCurrentClub: {
      matched: bothMatch(target.currentClubId, guess.currentClubId),
      weight: ATTRIBUTE_WEIGHTS.sameCurrentClub,
      guessValue: guess.currentClubName,
      hint: null,
    },
    wereTeammates: {
      matched: !!opts.wereTeammates,
      weight: ATTRIBUTE_WEIGHTS.wereTeammates,
      guessValue: null,
      hint: null,
    },
    sameNationalTeam: {
      matched: bothMatch(target.countryOfCitizenshipId, guess.countryOfCitizenshipId),
      weight: ATTRIBUTE_WEIGHTS.sameNationalTeam,
      guessValue: guess.countryOfCitizenshipName,
      hint: null,
    },
    sameSpecificPosition: {
      matched: bothMatch(target.primaryPosition, guess.primaryPosition),
      weight: ATTRIBUTE_WEIGHTS.sameSpecificPosition,
      guessValue: guess.primaryPosition,
      hint: null,
    },
    sameBirthCountry: {
      matched: bothMatch(target.countryOfBirthId, guess.countryOfBirthId),
      weight: ATTRIBUTE_WEIGHTS.sameBirthCountry,
      guessValue: guess.countryOfBirthName,
      hint: null,
    },
    sameCurrentLeague: {
      matched: bothMatch(target.currentLeagueId, guess.currentLeagueId),
      weight: ATTRIBUTE_WEIGHTS.sameCurrentLeague,
      guessValue: guess.currentLeagueName,
      hint: null,
    },
    sameRetired: {
      matched: target.isActive === guess.isActive,
      weight: ATTRIBUTE_WEIGHTS.sameRetired,
      guessValue: guess.isActive ? 'no' : 'yes',
      hint: null,
    },
    sameGenericPosition: {
      matched: bothMatch(target.genericPosition, guess.genericPosition),
      weight: ATTRIBUTE_WEIGHTS.sameGenericPosition,
      guessValue: guess.genericPosition,
      hint: null,
    },
    sharedTrophy: {
      matched: !!opts.sharedTrophy,
      weight: ATTRIBUTE_WEIGHTS.sharedTrophy,
      guessValue: null,
      hint: null,
    },
    sameContinent: {
      matched: bothMatch(target.citizenshipContinent, guess.citizenshipContinent),
      weight: ATTRIBUTE_WEIGHTS.sameContinent,
      guessValue: continentLabel(guess.citizenshipContinent),
      hint: null,
    },
    sameAge: {
      matched: targetAge !== null && targetAge === guessAge,
      weight: ATTRIBUTE_WEIGHTS.sameAge,
      guessValue: guessAge !== null ? `${guessAge}` : null,
      hint: numericHint(targetAge, guessAge),
    },
    sameHeightCm: {
      matched: bothMatch(target.heightCm, guess.heightCm),
      weight: ATTRIBUTE_WEIGHTS.sameHeightCm,
      guessValue: guess.heightCm ? `${guess.heightCm}cm` : null,
      hint: numericHint(target.heightCm, guess.heightCm),
    },
    sameJerseyNumber: {
      matched: false, // No data in MVP.
      weight: ATTRIBUTE_WEIGHTS.sameJerseyNumber,
      guessValue: null,
      hint: null,
    },
    sameFoot: {
      matched:
        target.foot !== 'unknown' &&
        guess.foot !== 'unknown' &&
        target.foot === guess.foot,
      weight: ATTRIBUTE_WEIGHTS.sameFoot,
      guessValue: footLabel(guess.foot),
      hint: null,
    },
  };

  const totalScore = Object.values(cells).reduce(
    (acc, c) => (c.matched ? acc + c.weight : acc),
    0,
  );

  return {
    totalScore,
    breakdown: cells,
    isCorrect: target.id === guess.id,
  };
}
