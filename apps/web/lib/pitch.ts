/**
 * Maps a player's specific position (e.g. "Right Winger") to a coordinate
 * on a 16:10 pitch rendered with goals on the LEFT and RIGHT.
 *
 * The pitch is read as: defenders on the LEFT, attackers on the RIGHT.
 * So Centre-Forward sits near x=85% and Goalkeeper near x=8%.
 */

export type PitchCoord = { x: number; y: number };

const POSITIONS: Record<string, PitchCoord> = {
  // Goalkeeper
  goalkeeper: { x: 7, y: 50 },

  // Defenders
  'centre-back': { x: 22, y: 50 },
  'left-back': { x: 22, y: 82 },
  'right-back': { x: 22, y: 18 },
  'left wing-back': { x: 32, y: 84 },
  'right wing-back': { x: 32, y: 16 },

  // Midfield
  'defensive midfield': { x: 38, y: 50 },
  'central midfield': { x: 50, y: 50 },
  'left midfield': { x: 52, y: 78 },
  'right midfield': { x: 52, y: 22 },
  'attacking midfield': { x: 65, y: 50 },

  // Forward
  'second striker': { x: 76, y: 50 },
  'centre-forward': { x: 86, y: 50 },
  'left winger': { x: 78, y: 80 },
  'right winger': { x: 78, y: 20 },
};

const GENERIC_FALLBACK: Record<string, PitchCoord> = {
  goalkeeper: { x: 7, y: 50 },
  defender: { x: 22, y: 50 },
  midfield: { x: 50, y: 50 },
  attack: { x: 80, y: 50 },
};

/** Deterministic small jitter so multiple guesses with the same position
 *  do not stack pixel-on-pixel. ±5% across both axes, seeded by id. */
function jitter(seed: number, axis: 'x' | 'y'): number {
  // Two cheap hashes from the same seed, one per axis.
  const h = Math.imul(seed ^ 0x9e3779b9, axis === 'x' ? 0x85ebca6b : 0xc2b2ae35);
  // [-5, 5]
  return ((h >>> 0) % 1000) / 100 - 5;
}

export function positionToCoord(
  primaryPosition: string | null,
  genericPosition: string | null,
  seed = 0,
): PitchCoord {
  const key = (primaryPosition ?? '').trim().toLowerCase();
  const generic = (genericPosition ?? '').trim().toLowerCase();
  const base = POSITIONS[key] ?? GENERIC_FALLBACK[generic] ?? { x: 50, y: 50 };
  return {
    x: clamp(base.x + jitter(seed, 'x'), 6, 94),
    y: clamp(base.y + jitter(seed, 'y'), 8, 92),
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Stat tone used by the UI to color chips and pins. */
export type Tone = 'hit' | 'warm' | 'cold';

/** Derive an overall "warmth" for a guess based on its scoring breakdown.
 *  - hit:  same current club is matched (the killer signal)
 *  - warm: ≥30% of total weight matched
 *  - cold: otherwise */
export function guessTone(
  totalScore: number,
  matchedSameClub: boolean,
  maxScore: number,
): Tone {
  if (matchedSameClub) return 'hit';
  if (totalScore >= maxScore * 0.3) return 'warm';
  return 'cold';
}
