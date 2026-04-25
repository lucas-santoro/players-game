'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { AttrCell, AttributeKey, Breakdown } from '@/lib/scoring';
import { ATTRIBUTE_WEIGHTS, MAX_TOTAL_SCORE } from '@/lib/scoring';
import { positionToCoord, guessTone, type Tone } from '@/lib/pitch';

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
  sameCurrentClub: 'clube',
  sameCurrentLeague: 'liga',
  sameNationalTeam: 'seleção',
  sameBirthCountry: 'nasc.',
  sameContinent: 'continente',
  sameSpecificPosition: 'posição',
  sameGenericPosition: 'setor',
  sameEra: 'era',
  sameAge: 'idade',
  sameHeightCm: 'altura',
  sameFoot: 'pé',
  wereTeammates: 'companheiros',
  sharedTrophy: 'troféu',
  sameJerseyNumber: 'camisa',
};

const STAT_CHIP_ORDER: AttributeKey[] = [
  'sameCurrentClub',
  'sameCurrentLeague',
  'sameNationalTeam',
  'sameBirthCountry',
  'sameContinent',
  'sameSpecificPosition',
  'sameGenericPosition',
  'sameEra',
  'sameAge',
  'sameHeightCm',
  'sameFoot',
];

const PT_MONTHS = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];

function formatPtDate(iso: string | null): string {
  if (!iso) return '· · ·';
  const d = new Date(iso + 'T00:00:00Z');
  if (isNaN(d.getTime())) return iso;
  return `${d.getUTCDate().toString().padStart(2, '0')} ${PT_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
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
        // Cheap "edition number" derived from days since 2026-01-01 — purely cosmetic.
        const epoch = Date.UTC(2026, 0, 1);
        const today = new Date(data.date + 'T00:00:00Z').getTime();
        setEditionNumber(Math.max(0, Math.floor((today - epoch) / 86_400_000)));
        const stored = localStorage.getItem(storageKey(data.date));
        if (stored) {
          try {
            setGuesses(JSON.parse(stored));
          } catch {}
        }
      })
      .catch(() => setError('Falha ao carregar o jogo de hoje.'));
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

  // The chip strip below the pitch follows whichever guess is currently
  // focused (clicked on the pitch or in the history). Defaults to the
  // newest guess so it has something to show after a fresh palpite.
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
        setError(`Erro ${res.status}`);
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

  function copyShareText() {
    if (!target) return;
    // One emoji ball per guess, in chronological order, matching the on-screen
    // trail. ⚪ = cold, 🟡 = warm, 🟢 = hit (same club), ⭐ = the winning guess.
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
      `${target.name} em ${tries} ${tries === 1 ? 'tentativa' : 'tentativas'}`,
      trail,
    ];
    navigator.clipboard.writeText(lines.join('\n'));
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col px-5 pb-3 pt-3 sm:px-8 lg:h-screen lg:gap-2 lg:overflow-hidden lg:pb-2">
      <Header
        date={date}
        editionNumber={editionNumber}
        tries={tries}
        won={isWon}
      />

      <div className="hairline mt-2" />

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
        <div className="sheet tilt-l mt-3 px-4 py-2" style={{ background: 'var(--cold-soft)' }}>
          <span className="label" style={{ color: 'var(--cold)' }}>erro</span>
          <p className="mt-1 text-sm" style={{ color: 'var(--ink)' }}>{error}</p>
        </div>
      )}

      <div className="mt-3 grid grid-cols-1 gap-4 lg:mt-2 lg:min-h-0 lg:flex-1 lg:grid-cols-[1.5fr_1fr] lg:gap-5">
        <div className="flex min-h-0 flex-col gap-2">
          <Pitch
            guesses={guesses}
            isWon={isWon}
            target={target}
            focusedGuess={focusedGuess}
            onFocus={(id) => setFocusedGuess(id)}
          />
          <Legend />
          {focusedGuessData && (
            <StatsStrip
              guess={focusedGuessData}
              focused={focusedGuess === focusedGuessData.guess.id}
            />
          )}
          {!guesses.length && (
            <div className="empty-tip mt-1">
              o alvo aparece em algum lugar do campo · seu palpite vai mostrar onde
            </div>
          )}
        </div>

        <div className="flex min-h-0 flex-col gap-2">
          {isWon && target ? (
            <WinPanel
              guesses={guesses}
              target={target}
              editionNumber={editionNumber}
              onShare={copyShareText}
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
    <header className="flex flex-wrap items-end justify-between gap-3 pt-2">
      <div>
        <div className="label">edição diária · n.º {editionNumber ?? '...'}</div>
        <h1
          className="hand-h mt-0.5 leading-none"
          style={{ fontSize: 'clamp(2rem, 4vw, 2.8rem)' }}
        >
          Players<span style={{ color: 'var(--accent)' }}>.</span>
        </h1>
        <p className="mt-0.5 max-w-md text-sm sm:text-base" style={{ color: '#3b352d' }}>
          adivinhe o jogador do dia. cada palpite vira um pino no campo.
        </p>
      </div>
      <div className="flex flex-col items-end gap-0.5 text-right">
        <span className="label">tentativas</span>
        <span
          className={`hand-h leading-none ${bump ? 'counter-bump' : ''}`}
          style={{
            fontSize: 'clamp(2.2rem, 5vw, 3.2rem)',
            color: won ? 'var(--accent)' : 'var(--ink)',
          }}
        >
          {String(tries).padStart(2, '0')}
        </span>
        <span className="label">{date ? formatPtDate(date) : '...'}</span>
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
  const submitFirst = () => {
    if (results[activeIdx]) onSubmit(results[activeIdx].id);
  };

  return (
    <section className="mt-5">
      <span className="label">próximo palpite</span>
      <div className="field-row relative mt-2">
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
          placeholder="digite um nome…"
          className="field"
          disabled={loading}
          autoComplete="off"
          spellCheck={false}
        />
        <button
          onClick={submitFirst}
          disabled={loading || results.length === 0}
          className="btn"
        >
          {loading ? '…' : 'palpitar'}
        </button>
        {showDropdown && results.length > 0 && (
          <ul className="dropdown" style={{ left: 0, right: 110 }}>
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
                  <span className="avatar" style={{ width: 36, height: 36 }}>
                    {r.photoUrl && (
                      <img src={r.photoUrl} alt="" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium" style={{ fontSize: 16 }}>
                      {r.name}
                    </div>
                    <div className="mono muted truncate text-[11px] uppercase tracking-wider">
                      {[r.currentClubName, r.citizenship].filter(Boolean).join(' · ') || '—'}
                    </div>
                  </div>
                  {used && <span className="label">tentado</span>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
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
  // Newest first: latest guess is index 0; we want #N to be the latest.
  const total = guesses.length;
  // Older renders first, so newest pin sits on top of the stack in z-order.
  const ordered = guesses.slice().reverse();

  return (
    <div className="sheet tilt-l p-2 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
      <div className="label mb-1 px-1">campo · cada pino é um palpite</div>
      <div className="pitch lg:aspect-auto lg:flex-1">
        <div className="pitch-circle" />

        {/* Confetti only on win */}
        {isWon && (
          <div className="confetti">
            <span className="c-a" />
            <span className="c-b" />
            <span className="c-c" />
            <span className="c-d" />
            <span className="c-e" />
            <span className="c-f" />
            <span className="c-g" />
            <span className="c-h" />
          </div>
        )}

        {/* Past guess pins. The winning guess is rendered by the target-reveal
            block below (same position, prevents duplicate stars + tag overlap). */}
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
              <div className="bub">{String(number).padStart(2, '0')}</div>
              {showTag && (
                <div className="tag">
                  {g.guess.name}
                  {guessPosition ? ` · ${guessPosition}` : ''}
                </div>
              )}
            </div>
          );
        })}

        {/* Target pin */}
        {(() => {
          if (isWon && target?.primaryPosition) {
            const { x, y } = positionToCoord(
              target.primaryPosition,
              null,
              target.id,
            );
            const anchor = x >= 65 ? 'tag-left' : x <= 35 ? 'tag-right' : '';
            return (
              <div className={`pin win ${anchor}`} style={{ top: `${y}%`, left: `${x}%` }}>
                <div className="bub">★</div>
                <div className="tag">{target.name}</div>
              </div>
            );
          }
          // empty / mid: target is at center as "?"
          return (
            <div className="pin target" style={{ top: '50%', left: '50%' }}>
              <div className="bub">?</div>
              <div className="tag">alvo · ?</div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-3 px-1">
      <span className="label" style={{ display: 'inline-flex', alignItems: 'center' }}>
        <span className="swatch hit" /> acerto
      </span>
      <span className="label" style={{ display: 'inline-flex', alignItems: 'center' }}>
        <span className="swatch warm" /> perto
      </span>
      <span className="label" style={{ display: 'inline-flex', alignItems: 'center' }}>
        <span className="swatch cold" /> longe
      </span>
      <span className="label">↓ alvo é menor · ↑ alvo é maior · ✓ acerto</span>
    </div>
  );
}

function StatsStrip({
  guess,
  focused,
}: {
  guess: GuessResponse;
  focused: boolean;
}) {
  return (
    // Fixed-height region so the pitch (flex-1 above) does not resize when
    // a different guess is focused and the chip strip happens to wrap to
    // a different number of rows. Internal scroll handles overflow.
    <div
      className="scroll-custom flex flex-col gap-1 overflow-y-auto px-1 lg:max-h-32 lg:min-h-32"
    >
      <span className="label shrink-0">
        {focused ? 'palpite selecionado · ' : 'último palpite · '}
        <span className="text-[color:var(--ink)]">{guess.guess.name}</span>
      </span>
      <div className="flex flex-wrap gap-2">
        {STAT_CHIP_ORDER.map((key) => {
          const cell = guess.breakdown[key];
          if (!cell) return null;
          const tone = cellTone(cell);
          const v = cell.guessValue ?? '—';
          const arrow = cell.hint === 'higher' ? ' ↑' : cell.hint === 'lower' ? ' ↓' : '';
          const checkmark = cell.matched ? ' ✓' : '';
          return (
            <span key={key} className={`stat-chip ${tone}`}>
              <span className="opacity-70">{ATTRIBUTE_LABELS[key]}</span>
              <span>{v}{arrow}{checkmark}</span>
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
      <span className="label px-1">histórico · do mais recente ao primeiro</span>
      {guesses.length === 0 ? (
        <div className="note mt-2">faça seu primeiro palpite</div>
      ) : (
        <div className="scroll-custom mt-2 min-h-0 flex-1 overflow-y-auto overflow-x-visible py-1 pr-2">
          {guesses.map((g, i) => {
            const number = guesses.length - i;
            const sameClubMatched = g.breakdown.sameCurrentClub?.matched ?? false;
            const tone = guessTone(
              g.totalScore,
              sameClubMatched,
              MAX_TOTAL_SCORE,
            );
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
                  <div className="truncate text-base font-medium leading-tight">
                    {g.guess.name}
                  </div>
                  <div className="mono muted text-[11px] uppercase leading-tight">
                    {(g.breakdown.sameSpecificPosition?.guessValue as string | null) ??
                      'posição —'}{' '}
                    · {pct}%
                  </div>
                </div>
                <div className="hand-h text-right" style={{ fontSize: 22 }}>
                  {g.totalScore.toLocaleString('pt-BR')}
                </div>
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
  onShare,
}: {
  guesses: GuessResponse[];
  target: TargetDetails;
  editionNumber: number | null;
  onShare: () => void;
}) {
  const tries = guesses.length;
  const [copied, setCopied] = useState(false);
  function handleShare() {
    onShare();
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="reveal-card">
        <div className="photo">
          {target.photoUrl && <img src={target.photoUrl} alt="" />}
        </div>
        <div className="min-w-0">
          <div className="hand-h truncate" style={{ fontSize: 24 }}>
            {target.name}
          </div>
          <div className="mono muted text-[11px] uppercase tracking-wider">
            {[target.primaryPosition, target.currentClubName, target.countryOfCitizenshipName]
              .filter(Boolean)
              .join(' · ')}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {target.dob && <span className="stat-chip hit">nasc. {target.dob}</span>}
            {target.marketValueEur && (
              <span className="stat-chip">
                €{(Number(target.marketValueEur) / 1_000_000).toFixed(0)}M
              </span>
            )}
            {target.currentLeagueName && (
              <span className="stat-chip">{target.currentLeagueName}</span>
            )}
          </div>
        </div>
      </div>

      <ShareScorecard
        guesses={guesses}
        target={target}
        editionNumber={editionNumber}
      />


      <div className="flex flex-wrap gap-2">
        <button onClick={handleShare} className="btn">
          {copied ? 'copiado ✓' : 'compartilhar'}
        </button>
        <button className="btn ghost" onClick={() => window.location.reload()}>
          revisar palpites
        </button>
      </div>

      <GuessHistory
        guesses={guesses}
        focusedGuess={null}
        onFocus={() => {}}
      />
    </div>
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
  const trail = guesses.slice().reverse(); // oldest -> newest
  return (
    <div className="share-card">
      <div className="head">
        <span className="ttl">
          encontrei em{' '}
          <span className="accent">{String(tries).padStart(2, '0')}</span>
        </span>
        <span className="meta">edição #{editionNumber ?? 0}</span>
      </div>

      <div className="share-trail" aria-label="trilha de palpites">
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

function Footer() {
  return (
    <footer className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t-2 border-[color:var(--ink)] pt-2 text-[color:var(--muted-2)]">
      <span className="label">players · 2026 · low-fi</span>
      <SocialBar />
      <span className="label">dados · transfermarkt</span>
    </footer>
  );
}

function SocialBar() {
  return (
    <nav aria-label="redes sociais" className="flex items-center gap-2">
      <SocialButton
        href="https://linkedin.com/in/lucas-santoro"
        label="LinkedIn"
        title="LinkedIn / lucas-santoro"
      >
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden focusable="false">
          <path
            fill="currentColor"
            d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.13 1.45-2.13 2.94v5.67H9.36V9h3.41v1.56h.05c.48-.91 1.65-1.86 3.4-1.86 3.64 0 4.31 2.39 4.31 5.51v6.24zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zm1.78 13.02H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.72v20.55C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.72C24 .77 23.2 0 22.22 0z"
          />
        </svg>
      </SocialButton>
      <SocialButton
        href="https://github.com/lucas-santoro"
        label="GitHub"
        title="GitHub / lucas-santoro"
      >
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden focusable="false">
          <path
            fill="currentColor"
            d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.69 1.24 3.34.95.1-.74.4-1.24.72-1.53-2.55-.29-5.24-1.27-5.24-5.66 0-1.25.45-2.27 1.18-3.07-.12-.29-.51-1.46.11-3.04 0 0 .96-.31 3.15 1.17a10.93 10.93 0 0 1 5.74 0c2.19-1.48 3.15-1.17 3.15-1.17.62 1.58.23 2.75.11 3.04.74.8 1.18 1.82 1.18 3.07 0 4.4-2.7 5.36-5.27 5.65.41.36.78 1.06.78 2.13v3.16c0 .31.21.67.8.55C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z"
          />
        </svg>
      </SocialButton>
      <SocialButton label="Instagram" title="Instagram (em breve)" disabled>
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden focusable="false">
          <path
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3.5 7.5a4 4 0 0 1 4-4h9a4 4 0 0 1 4 4v9a4 4 0 0 1-4 4h-9a4 4 0 0 1-4-4z M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8z M17.5 6.6h.02"
          />
        </svg>
      </SocialButton>
      <SocialButton label="X" title="X (em breve)" disabled>
        <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden focusable="false">
          <path
            fill="currentColor"
            d="M18.244 2H21l-6.518 7.45L22 22h-6.828l-4.78-6.243L4.8 22H2.043l6.974-7.97L2 2h6.97l4.32 5.71L18.244 2zm-2.39 18h1.85L7.27 4H5.31l10.544 16z"
          />
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
    'inline-flex h-8 w-8 items-center justify-center rounded-full border-2 border-[color:var(--ink)] bg-[color:var(--paper-card)] text-[color:var(--ink)] transition ' +
    (disabled
      ? 'opacity-40 cursor-not-allowed'
      : 'hover:bg-[color:var(--accent)] hover:text-white hover:-translate-y-0.5');
  const style = { boxShadow: '2px 2px 0 var(--ink)' };
  if (disabled || !href) {
    return (
      <span className={className} style={style} title={title} aria-disabled="true">
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
      style={style}
      title={title}
    >
      <span className="sr-only">{label}</span>
      {children}
    </a>
  );
}
