'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { AttrCell, AttributeKey, Breakdown } from '@/lib/scoring';
import { ATTRIBUTE_WEIGHTS, MAX_TOTAL_SCORE } from '@/lib/scoring';
import { positionToCoord, guessTone, type Tone } from '@/lib/pitch';

const TEASERS = [
  'how few can you do it in?',
  'can you beat it?',
  'try to beat me',
  "bet you can't",
];

function pickTeaser(seed: number): string {
  return TEASERS[Math.abs(seed) % TEASERS.length];
}

type SearchResult = {
  id: number;
  name: string;
  currentClubName: string | null;
  citizenship: string | null;
  photoUrl: string | null;
};

type TargetDetails = {
  id: number;
  name: string;
  photoUrl: string | null;
  currentClubName: string | null;
  currentLeagueName: string | null;
  countryOfCitizenshipName: string | null;
  primaryPosition: string | null;
  dob: string | null;
  marketValueEur: string | null;
};

type GuessResponse = {
  guess: { id: number; name: string; photoUrl: string | null };
  totalScore: number;
  breakdown: Breakdown;
  isCorrect: boolean;
  targetDetails?: TargetDetails;
};

const ATTRIBUTE_LABELS: Record<AttributeKey, string> = {
  sameCurrentClub: 'club',
  sameCurrentLeague: 'league',
  sameNationalTeam: 'nat. team',
  sameBirthCountry: 'born',
  sameContinent: 'continent',
  sameSpecificPosition: 'position',
  sameGenericPosition: 'role',
  sameRetired: 'retired',
  sameAge: 'age',
  sameHeightCm: 'height',
  sameFoot: 'foot',
  wereTeammates: 'teammates',
  sharedTrophy: 'trophy',
  sameJerseyNumber: 'jersey',
};

const STAT_CHIP_ORDER: AttributeKey[] = [
  'sameCurrentClub',
  'sameCurrentLeague',
  'sameNationalTeam',
  'sameBirthCountry',
  'sameContinent',
  'sameSpecificPosition',
  'sameGenericPosition',
  'sameRetired',
  'sameAge',
  'sameHeightCm',
  'sameFoot',
];

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function formatDate(iso: string | null): string {
  if (!iso) return '· · ·';
  const d = new Date(iso + 'T00:00:00Z');
  if (isNaN(d.getTime())) return iso;
  return `${d.getUTCDate().toString().padStart(2, '0')} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function storageKey(date: string) {
  return `players-game:guesses:${date}`;
}

function cellTone(cell: AttrCell | undefined): Tone {
  if (!cell) return 'cold';
  if (cell.matched) return 'hit';
  if (cell.hint) return 'warm';
  return 'cold';
}

export default function HomePage() {
  const [date, setDate] = useState<string | null>(null);
  const [editionNumber, setEditionNumber] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [guesses, setGuesses] = useState<GuessResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [focusedGuess, setFocusedGuess] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/api/today')
      .then((r) => r.json())
      .then((data) => {
        setDate(data.date);
        const epoch = Date.UTC(2026, 0, 1);
        const today = new Date(data.date + 'T00:00:00Z').getTime();
        setEditionNumber(Math.max(0, Math.floor((today - epoch) / 86_400_000)));
        const stored = localStorage.getItem(storageKey(data.date));
        if (stored) {
          try { setGuesses(JSON.parse(stored)); } catch {}
        }
      })
      .catch(() => setError("Failed to load today's game."));
  }, []);

  useEffect(() => {
    if (date) localStorage.setItem(storageKey(date), JSON.stringify(guesses));
  }, [date, guesses]);

  useEffect(() => {
    if (query.trim().length < 1) {
      setResults([]);
      return;
    }
    const handle = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(query.trim())}`)
        .then((r) => r.json())
        .then((data) => {
          setResults(data.results || []);
          setActiveIdx(0);
        })
        .catch(() => setResults([]));
    }, 130);
    return () => clearTimeout(handle);
  }, [query]);

  const guessedIds = useMemo(
    () => new Set(guesses.map((g) => g.guess.id)),
    [guesses],
  );
  const isWon = guesses.some((g) => g.isCorrect);
  const tries = guesses.length;
  const target = guesses.find((g) => g.isCorrect)?.targetDetails ?? null;

  const latestGuess = guesses[0];
  const focusedGuessData =
    guesses.find((g) => g.guess.id === focusedGuess) ?? latestGuess;

  async function submitGuess(playerId: number) {
    if (guessedIds.has(playerId) || isWon || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/guess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId }),
      });
      if (!res.ok) {
        setError(`Error ${res.status}`);
        return;
      }
      const data: GuessResponse = await res.json();
      setGuesses((prev) => [data, ...prev]);
      setQuery('');
      setResults([]);
      setShowDropdown(false);
      setFocusedGuess(data.guess.id);
      inputRef.current?.focus();
    } finally {
      setLoading(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' && results.length > 0) {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp' && results.length > 0) {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && results[activeIdx]) {
      e.preventDefault();
      submitGuess(results[activeIdx].id);
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
    }
  }

  function buildShareText(): string {
    const trail = guesses
      .slice()
      .reverse()
      .map((g) => {
        if (g.isCorrect) return '⭐';
        const sameClub = g.breakdown.sameCurrentClub?.matched ?? false;
        const tone = guessTone(g.totalScore, sameClub, MAX_TOTAL_SCORE);
        return tone === 'hit' ? '🟢' : tone === 'warm' ? '🟡' : '⚪';
      })
      .join(' ');
    const lines = [
      `Players · #${editionNumber ?? 0}`,
      `Found in ${tries} ${tries === 1 ? 'attempt' : 'attempts'} — how few can you do it in?`,
      trail,
    ];
    return lines.join('\n');
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col px-4 pb-4 pt-4 sm:px-8 lg:h-screen lg:gap-3 lg:overflow-hidden lg:pb-3">
      <Header
        date={date}
        editionNumber={editionNumber}
        tries={tries}
        won={isWon}
      />

      <div className="section-hr" />

      {!isWon && (
        <SearchBox
          inputRef={inputRef}
          query={query}
          setQuery={setQuery}
          results={results}
          showDropdown={showDropdown}
          setShowDropdown={setShowDropdown}
          activeIdx={activeIdx}
          setActiveIdx={setActiveIdx}
          guessedIds={guessedIds}
          loading={loading}
          onSubmit={submitGuess}
          onKeyDown={onKeyDown}
        />
      )}

      {error && (
        <div
          className="block-card mt-3 px-4 py-3"
          style={{ background: 'var(--error-soft)', borderColor: 'var(--error)' }}
        >
          <span className="eyebrow" style={{ color: 'var(--error)' }}>error</span>
          <p className="mt-1 text-sm" style={{ color: 'var(--ink)' }}>{error}</p>
        </div>
      )}

      <div className="mt-3 grid grid-cols-1 gap-3 lg:mt-2 lg:min-h-0 lg:flex-1 lg:grid-cols-[1.55fr_1fr] lg:gap-4">
        <div className="flex min-h-0 flex-col gap-2">
          <Pitch
            guesses={guesses}
            isWon={isWon}
            target={target}
            focusedGuess={focusedGuess}
            onFocus={(id) => setFocusedGuess(id)}
          />
          <Legend />
          {!isWon && focusedGuessData && (
            <StatsStrip
              guess={focusedGuessData}
              focused={focusedGuess === focusedGuessData.guess.id}
            />
          )}
          {!guesses.length && !isWon && (
            <div className="empty-tip">
              the target sits somewhere on the pitch · your guess will reveal where
            </div>
          )}
        </div>

        <div className="flex min-h-0 flex-col gap-2">
          {isWon && target ? (
            <WinPanel
              guesses={guesses}
              target={target}
              editionNumber={editionNumber}
              onShareText={() => buildShareText()}
              focusedGuess={focusedGuess}
              onFocus={(id) => setFocusedGuess(id)}
            />
          ) : (
            <GuessHistory
              guesses={guesses}
              focusedGuess={focusedGuess}
              onFocus={(id) => setFocusedGuess(id)}
            />
          )}
        </div>
      </div>

      <Footer />
    </main>
  );
}

/* ─────────────────────────────────────────────── HEADER ──── */

function Header({
  date,
  editionNumber,
  tries,
  won,
}: {
  date: string | null;
  editionNumber: number | null;
  tries: number;
  won: boolean;
}) {
  const triesPrev = useRef(tries);
  const [bump, setBump] = useState(false);
  useEffect(() => {
    if (tries !== triesPrev.current) {
      triesPrev.current = tries;
      setBump(true);
      const t = setTimeout(() => setBump(false), 480);
      return () => clearTimeout(t);
    }
  }, [tries]);

  return (
    <header className="flex items-end justify-between gap-3 pt-1">
      <div className="min-w-0 flex-1">
        <span className="match-tag">
          <span className="dot" />
          Match · No. {editionNumber ?? '...'}
        </span>
        <h1
          className="display mt-1.5"
          style={{ fontSize: 'clamp(2.4rem, 7vw, 4.4rem)' }}
        >
          Players<span style={{ color: 'var(--primary)' }}>.</span>
        </h1>
        <p className="mt-0 max-w-md text-sm sm:text-base" style={{ color: 'var(--ink-2)' }}>
          guess the player of the day. each guess places a pin on the pitch.
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1 text-right">
        <span className="eyebrow">attempts</span>
        <span
          className={`display-num ${bump ? 'counter-tick' : ''}`}
          style={{
            fontSize: 'clamp(2.6rem, 6vw, 4rem)',
            color: won ? 'var(--gold-deep)' : 'var(--ink)',
          }}
        >
          {String(tries).padStart(2, '0')}
        </span>
        <span className="eyebrow whitespace-nowrap">
          {date ? formatDate(date) : '...'}
        </span>
      </div>
    </header>
  );
}

/* ─────────────────────────────────────────────── SEARCH ──── */

function SearchBox({
  inputRef,
  query,
  setQuery,
  results,
  showDropdown,
  setShowDropdown,
  activeIdx,
  setActiveIdx,
  guessedIds,
  loading,
  onSubmit,
  onKeyDown,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  query: string;
  setQuery: (v: string) => void;
  results: SearchResult[];
  showDropdown: boolean;
  setShowDropdown: (v: boolean) => void;
  activeIdx: number;
  setActiveIdx: (v: number) => void;
  guessedIds: Set<number>;
  loading: boolean;
  onSubmit: (id: number) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  const submit = () => results[activeIdx] && onSubmit(results[activeIdx].id);
  return (
    <section className="mt-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="eyebrow">next guess</span>
      </div>
      <div className="relative flex gap-2">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShowDropdown(true);
          }}
          onFocus={() => setShowDropdown(true)}
          onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
          onKeyDown={onKeyDown}
          placeholder="type a name…"
          className="field"
          disabled={loading}
          autoComplete="off"
          spellCheck={false}
        />
        <button
          onClick={submit}
          disabled={loading || results.length === 0}
          className="btn-primary"
          aria-label="submit guess"
        >
          {loading ? '…' : 'guess'}
          <ArrowRightIcon />
        </button>
        {showDropdown && results.length > 0 && (
          <ul className="dropdown scroll-custom" style={{ right: 0 }}>
            {results.map((r, i) => {
              const used = guessedIds.has(r.id);
              const active = i === activeIdx;
              return (
                <li
                  key={r.id}
                  className={`${active ? 'active' : ''} ${used ? 'used' : ''}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    if (!used) onSubmit(r.id);
                  }}
                  onMouseEnter={() => setActiveIdx(i)}
                >
                  <span className="avatar">
                    {r.photoUrl && <img src={r.photoUrl} alt="" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="name truncate">{r.name}</div>
                    <div className="meta truncate">
                      {[r.currentClubName, r.citizenship].filter(Boolean).join(' · ') || '—'}
                    </div>
                  </div>
                  {used && <span className="eyebrow">tried</span>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

function ArrowRightIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden>
      <path d="M5 12h14M13 5l7 7-7 7" strokeLinecap="square" strokeLinejoin="miter" />
    </svg>
  );
}

/* ─────────────────────────────────────────────── PITCH ──── */

function Pitch({
  guesses,
  isWon,
  target,
  focusedGuess,
  onFocus,
}: {
  guesses: GuessResponse[];
  isWon: boolean;
  target: TargetDetails | null;
  focusedGuess: number | null;
  onFocus: (id: number) => void;
}) {
  const total = guesses.length;
  const ordered = guesses.slice().reverse();
  return (
    <div className="block-card thick lg:flex lg:min-h-0 lg:flex-[1_1_auto] lg:flex-col">
      <div className="flex items-center justify-between border-b-2 border-[color:var(--ink)] px-3 py-2">
        <span className="eyebrow">field of play</span>
        <span className="eyebrow">{total > 0 ? `${total} pins` : 'awaiting kickoff'}</span>
      </div>
      <div className="relative p-2 lg:flex-1 lg:min-h-0">
        <div className="pitch-frame relative h-full w-full lg:aspect-auto">
          <span className="corner tl" />
          <span className="corner tr" />
          <span className="corner bl" />
          <span className="corner br" />
          <div className="pitch-circle" />
          <div className="pitch-spot" />

          {isWon && (
            <div className="confetti">
              <span className="c-a" /><span className="c-b" /><span className="c-c" />
              <span className="c-d" /><span className="c-e" /><span className="c-f" />
              <span className="c-g" /><span className="c-h" />
            </div>
          )}

          {ordered.map((g, idx) => {
            if (g.isCorrect) return null;
            const number = idx + 1;
            const isLatest = !isWon && number === total;
            const cell = g.breakdown.sameSpecificPosition;
            const guessPosition = (cell?.guessValue ?? null) as string | null;
            const generic = (g.breakdown.sameGenericPosition?.guessValue ?? null) as
              | string
              | null;
            const { x, y } = positionToCoord(guessPosition, generic, g.guess.id);
            const sameClubMatched = g.breakdown.sameCurrentClub?.matched ?? false;
            const tone = guessTone(g.totalScore, sameClubMatched, MAX_TOTAL_SCORE);
            const isFocused = focusedGuess === g.guess.id;
            const dimWhenWon = isWon && !isFocused ? 'opacity-50' : '';
            const tagAnchor = x >= 65 ? 'tag-left' : x <= 35 ? 'tag-right' : '';
            const cls = ['pin', tone, isFocused ? 'focus' : '', dimWhenWon, tagAnchor]
              .filter(Boolean)
              .join(' ');
            const showTag = isFocused || isLatest;
            return (
              <div
                key={g.guess.id}
                className={cls}
                style={{ top: `${y}%`, left: `${x}%` }}
                onClick={(e) => {
                  e.stopPropagation();
                  onFocus(g.guess.id);
                }}
                title={`#${String(number).padStart(2, '0')} · ${g.guess.name} · ${guessPosition ?? '?'}`}
              >
                <div className="ball">{String(number).padStart(2, '0')}</div>
                {showTag && (
                  <div className="nameplate">
                    {g.guess.name}
                  </div>
                )}
              </div>
            );
          })}

          {(() => {
            if (isWon && target?.primaryPosition) {
              const { x, y } = positionToCoord(target.primaryPosition, null, target.id);
              const anchor = x >= 65 ? 'tag-left' : x <= 35 ? 'tag-right' : '';
              return (
                <div className={`pin win ${anchor}`} style={{ top: `${y}%`, left: `${x}%` }}>
                  <div className="ball">★</div>
                  <div className="nameplate" style={{ background: 'var(--gold)', color: 'var(--on-gold)' }}>
                    {target.name}
                  </div>
                </div>
              );
            }
            return (
              <div className="pin target" style={{ top: '50%', left: '50%' }}>
                <div className="ball">?</div>
                <div className="nameplate">target · ?</div>
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1">
      <LegendDot tone="hit" label="match" />
      <LegendDot tone="warm" label="close" />
      <LegendDot tone="cold" label="far" />
      <span className="eyebrow">↓ target lower · ↑ target higher · ✓ exact</span>
    </div>
  );
}

function LegendDot({ tone, label }: { tone: 'hit' | 'warm' | 'cold'; label: string }) {
  const bg = tone === 'hit' ? 'var(--primary)' : tone === 'warm' ? 'var(--gold)' : 'var(--paper-2)';
  return (
    <span className="eyebrow inline-flex items-center gap-1.5">
      <span
        style={{
          display: 'inline-block',
          width: 10,
          height: 10,
          background: bg,
          border: '1.5px solid var(--ink)',
        }}
      />
      {label}
    </span>
  );
}

function StatsStrip({ guess, focused }: { guess: GuessResponse; focused: boolean }) {
  return (
    <div className="scroll-custom flex flex-col gap-1 overflow-y-auto px-1 lg:max-h-32 lg:min-h-32">
      <span className="eyebrow shrink-0">
        {focused ? 'selected · ' : 'last guess · '}
        <span style={{ color: 'var(--ink)' }}>{guess.guess.name}</span>
      </span>
      <div className="flex flex-wrap gap-1.5">
        {STAT_CHIP_ORDER.map((key) => {
          const cell = guess.breakdown[key];
          if (!cell) return null;
          const tone = cellTone(cell);
          const v = cell.guessValue ?? '—';
          const arrow = cell.hint === 'higher' ? ' ↑' : cell.hint === 'lower' ? ' ↓' : '';
          const checkmark = cell.matched ? ' ✓' : '';
          return (
            <span key={key} className={`chip ${tone}`}>
              <span className="k">{ATTRIBUTE_LABELS[key]}</span>
              <span className="v">{v}{arrow}{checkmark}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────── HISTORY ──── */

function GuessHistory({
  guesses,
  focusedGuess,
  onFocus,
}: {
  guesses: GuessResponse[];
  focusedGuess: number | null;
  onFocus: (id: number) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1">
      <div className="flex items-center justify-between px-1">
        <span className="eyebrow">guess sheet · newest first</span>
        <span className="eyebrow">{guesses.length} attempt{guesses.length === 1 ? '' : 's'}</span>
      </div>
      {guesses.length === 0 ? (
        <div className="note mt-2">make your first guess</div>
      ) : (
        <div className="scroll-custom mt-1 flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto py-1 pr-2">
          {guesses.map((g, i) => {
            const number = guesses.length - i;
            const sameClubMatched = g.breakdown.sameCurrentClub?.matched ?? false;
            const tone = guessTone(g.totalScore, sameClubMatched, MAX_TOTAL_SCORE);
            const pct = Math.round((g.totalScore / MAX_TOTAL_SCORE) * 100);
            const isFocused = focusedGuess === g.guess.id;
            return (
              <article
                key={`${g.guess.id}-${i}`}
                className={`guess-row ${tone} ${isFocused ? 'focus' : ''} ${i === 0 ? 'guess-enter' : ''}`}
                onClick={() => onFocus(g.guess.id)}
              >
                <span className="num">#{String(number).padStart(2, '0')}</span>
                <span className="avatar">
                  {g.guess.photoUrl && <img src={g.guess.photoUrl} alt="" />}
                </span>
                <div className="min-w-0">
                  <div className="name truncate">{g.guess.name}</div>
                  <div className="meta truncate">
                    {(g.breakdown.sameSpecificPosition?.guessValue as string | null) ??
                      'position —'}{' '}
                    · {pct}%
                  </div>
                </div>
                <div className="score">{g.totalScore.toLocaleString('en-US')}</div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────── WIN ──── */

function WinPanel({
  guesses,
  target,
  editionNumber,
  onShareText,
  focusedGuess,
  onFocus,
}: {
  guesses: GuessResponse[];
  target: TargetDetails;
  editionNumber: number | null;
  onShareText: () => string;
  focusedGuess: number | null;
  onFocus: (id: number) => void;
}) {
  const [copied, setCopied] = useState<'image' | 'text' | null>(null);
  const captureRef = useRef<HTMLDivElement | null>(null);
  const teaser = useMemo(
    () => pickTeaser((editionNumber ?? 0) + (target.id ?? 0)),
    [editionNumber, target.id],
  );

  async function handleShare() {
    const text = onShareText();
    let imageWritten = false;
    if (captureRef.current && typeof window !== 'undefined') {
      try {
        const { toBlob } = await import('html-to-image');
        const blob = await toBlob(captureRef.current, {
          pixelRatio: 2,
          cacheBust: true,
          backgroundColor: '#1a0606',
        });
        if (blob && navigator.clipboard && 'write' in navigator.clipboard) {
          const items: Record<string, Blob> = { 'image/png': blob };
          items['text/plain'] = new Blob([text], { type: 'text/plain' });
          await navigator.clipboard.write([new ClipboardItem(items)]);
          imageWritten = true;
        }
      } catch (err) {
        console.warn('Image clipboard write failed, falling back to text', err);
      }
    }
    if (!imageWritten) {
      try { await navigator.clipboard.writeText(text); } catch {}
    }
    setCopied(imageWritten ? 'image' : 'text');
    setTimeout(() => setCopied(null), 2200);
  }

  const shareLabel =
    copied === 'image' ? 'image copied' : copied === 'text' ? 'text copied' : 'share result';

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {/* Player card */}
      <div className="player-card">
        <div className="ribbon">target · revealed</div>
        <div className="photo">
          {target.photoUrl && <img src={target.photoUrl} alt="" />}
        </div>
        <div className="min-w-0">
          <div className="display truncate" style={{ fontSize: 28, fontWeight: 800 }}>
            {target.name}
          </div>
          <div className="mono mt-1 text-[11px]" style={{ color: 'var(--ink-2)' }}>
            {[target.primaryPosition, target.currentClubName, target.countryOfCitizenshipName]
              .filter(Boolean)
              .join(' · ')
              .toUpperCase()}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {target.dob && <span className="chip hit">
              <span className="k">born</span><span className="v">{target.dob}</span>
            </span>}
            {target.marketValueEur && <span className="chip">
              <span className="k">value</span><span className="v">€{(Number(target.marketValueEur) / 1_000_000).toFixed(0)}M</span>
            </span>}
            {target.currentLeagueName && <span className="chip">
              <span className="k">league</span><span className="v">{target.currentLeagueName}</span>
            </span>}
          </div>
        </div>
      </div>

      {/* Scoreboard */}
      <ShareScorecard guesses={guesses} target={target} editionNumber={editionNumber} />

      <ShareImageCapture
        captureRef={captureRef}
        guesses={guesses}
        editionNumber={editionNumber}
        teaser={teaser}
      />

      <div className="flex flex-wrap gap-2">
        <button onClick={handleShare} className="btn-gold">
          {shareLabel}
          <ShareIcon />
        </button>
      </div>

      <GuessHistory guesses={guesses} focusedGuess={focusedGuess} onFocus={onFocus} />
    </div>
  );
}

function ShareIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden>
      <path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v13" strokeLinecap="square" strokeLinejoin="miter" />
    </svg>
  );
}

function ShareScorecard({
  guesses,
  target,
  editionNumber,
}: {
  guesses: GuessResponse[];
  target: TargetDetails;
  editionNumber: number | null;
}) {
  const tries = guesses.length;
  const trail = guesses.slice().reverse();
  return (
    <div className="scoreboard">
      <div className="head">
        <span className="ttl">
          found in <span className="num">{String(tries).padStart(2, '0')}</span>
        </span>
        <span className="meta">edition #{editionNumber ?? 0}</span>
      </div>

      <div className="trail" aria-label="guess trail">
        {trail.map((g, i) => {
          const sameClubMatched = g.breakdown.sameCurrentClub?.matched ?? false;
          const tone = guessTone(g.totalScore, sameClubMatched, MAX_TOTAL_SCORE);
          const cls = g.isCorrect ? 'win' : tone;
          return (
            <span
              key={`${g.guess.id}-${i}`}
              className={`ball ${cls}`}
              title={`#${String(i + 1).padStart(2, '0')} · ${g.guess.name}`}
            >
              {g.isCorrect ? '★' : i + 1}
            </span>
          );
        })}
      </div>

      <div className="foot">
        <span className="name">{target.name}</span>
        <span>players game</span>
      </div>
    </div>
  );
}

function ShareImageCapture({
  captureRef,
  guesses,
  editionNumber,
  teaser,
}: {
  captureRef: React.MutableRefObject<HTMLDivElement | null>;
  guesses: GuessResponse[];
  editionNumber: number | null;
  teaser: string;
}) {
  const tries = guesses.length;
  const trail = guesses.slice().reverse();
  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        top: -10000,
        left: -10000,
        pointerEvents: 'none',
        zIndex: -1,
      }}
    >
      <div
        ref={captureRef}
        className="scoreboard"
        style={{ width: 540, padding: '20px 24px', gap: 14 }}
      >
        <div className="head">
          <span className="ttl" style={{ fontSize: 28 }}>
            found in <span className="num" style={{ fontSize: 36 }}>
              {String(tries).padStart(2, '0')}
            </span>
          </span>
          <span className="meta">edition #{editionNumber ?? 0}</span>
        </div>
        <div className="trail" style={{ rowGap: 8 }}>
          {trail.map((g, i) => {
            const sameClubMatched = g.breakdown.sameCurrentClub?.matched ?? false;
            const tone = guessTone(g.totalScore, sameClubMatched, MAX_TOTAL_SCORE);
            const cls = g.isCorrect ? 'win' : tone;
            return (
              <span key={`${g.guess.id}-${i}`} className={`ball ${cls}`}>
                {g.isCorrect ? '★' : i + 1}
              </span>
            );
          })}
        </div>
        <div className="foot">
          <span className="name" style={{ fontStyle: 'italic' }}>{teaser}</span>
          <span>players game</span>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────── FOOTER ──── */

function Footer() {
  return (
    <footer className="mt-2 flex flex-wrap items-center justify-between gap-3 border-t-2 border-[color:var(--ink)] pt-2">
      <span className="eyebrow">players · 2026 · matchday 01</span>
      <SocialBar />
      <span className="eyebrow">data · transfermarkt</span>
    </footer>
  );
}

function SocialBar() {
  return (
    <nav aria-label="social" className="flex items-center gap-2">
      <SocialButton href="https://linkedin.com/in/lucas-santoro" label="LinkedIn" title="LinkedIn / lucas-santoro">
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden focusable="false">
          <path fill="currentColor" d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.13 1.45-2.13 2.94v5.67H9.36V9h3.41v1.56h.05c.48-.91 1.65-1.86 3.4-1.86 3.64 0 4.31 2.39 4.31 5.51v6.24zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zm1.78 13.02H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.72v20.55C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.72C24 .77 23.2 0 22.22 0z" />
        </svg>
      </SocialButton>
      <SocialButton href="https://github.com/lucas-santoro" label="GitHub" title="GitHub / lucas-santoro">
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden focusable="false">
          <path fill="currentColor" d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.69 1.24 3.34.95.1-.74.4-1.24.72-1.53-2.55-.29-5.24-1.27-5.24-5.66 0-1.25.45-2.27 1.18-3.07-.12-.29-.51-1.46.11-3.04 0 0 .96-.31 3.15 1.17a10.93 10.93 0 0 1 5.74 0c2.19-1.48 3.15-1.17 3.15-1.17.62 1.58.23 2.75.11 3.04.74.8 1.18 1.82 1.18 3.07 0 4.4-2.7 5.36-5.27 5.65.41.36.78 1.06.78 2.13v3.16c0 .31.21.67.8.55C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z" />
        </svg>
      </SocialButton>
      <SocialButton label="Instagram" title="Instagram (soon)" disabled>
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden focusable="false">
          <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
            d="M3.5 7.5a4 4 0 0 1 4-4h9a4 4 0 0 1 4 4v9a4 4 0 0 1-4 4h-9a4 4 0 0 1-4-4z M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8z M17.5 6.6h.02" />
        </svg>
      </SocialButton>
      <SocialButton label="X" title="X (soon)" disabled>
        <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden focusable="false">
          <path fill="currentColor" d="M18.244 2H21l-6.518 7.45L22 22h-6.828l-4.78-6.243L4.8 22H2.043l6.974-7.97L2 2h6.97l4.32 5.71L18.244 2zm-2.39 18h1.85L7.27 4H5.31l10.544 16z" />
        </svg>
      </SocialButton>
    </nav>
  );
}

function SocialButton({
  href,
  label,
  title,
  children,
  disabled = false,
}: {
  href?: string;
  label: string;
  title: string;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  const className =
    'inline-flex h-8 w-8 items-center justify-center border-2 border-[color:var(--ink)] bg-[color:var(--paper-2)] text-[color:var(--ink)] transition-colors duration-200 ' +
    (disabled
      ? 'opacity-40 cursor-not-allowed'
      : 'hover:bg-[color:var(--ink)] hover:text-[color:var(--paper)] cursor-pointer');
  if (disabled || !href) {
    return (
      <span className={className} title={title} aria-disabled="true">
        <span className="sr-only">{label}</span>
        {children}
      </span>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      title={title}
    >
      <span className="sr-only">{label}</span>
      {children}
    </a>
  );
}
