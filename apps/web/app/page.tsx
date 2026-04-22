'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { AttrCell, Breakdown, AttributeKey } from '@/lib/scoring';
import { ATTRIBUTE_WEIGHTS, MAX_TOTAL_SCORE } from '@/lib/scoring';

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
  sameCurrentClub: 'CLUBE',
  wereTeammates: 'COMPANHEIROS',
  sameNationalTeam: 'SELEÇÃO',
  sameSpecificPosition: 'POSIÇÃO',
  sameBirthCountry: 'NASCIMENTO',
  sameCurrentLeague: 'LIGA',
  sameEra: 'ERA',
  sameGenericPosition: 'SETOR',
  sharedTrophy: 'TROFÉU',
  sameContinent: 'CONTINENTE',
  sameAge: 'IDADE',
  sameHeightCm: 'ALTURA',
  sameJerseyNumber: 'CAMISA',
  sameFoot: 'PÉ',
};

const ATTRIBUTE_ORDER: AttributeKey[] = [
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
  'wereTeammates',
  'sharedTrophy',
  'sameJerseyNumber',
];

const PT_MONTHS = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
const PT_WEEKDAYS = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];

function formatPtDate(iso: string | null): string {
  if (!iso) return '· · ·';
  const d = new Date(iso + 'T00:00:00Z');
  if (isNaN(d.getTime())) return iso;
  return `${PT_WEEKDAYS[d.getUTCDay()]} · ${d.getUTCDate().toString().padStart(2, '0')} ${PT_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function storageKey(date: string) {
  return `players-game:guesses:${date}`;
}

export default function HomePage() {
  const [date, setDate] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [guesses, setGuesses] = useState<GuessResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/api/today')
      .then((r) => r.json())
      .then((data) => {
        setDate(data.date);
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

  const guessedIds = useMemo(() => new Set(guesses.map((g) => g.guess.id)), [guesses]);
  const isWon = guesses.some((g) => g.isCorrect);
  const tries = guesses.length;

  async function submitGuess(playerId: number) {
    if (guessedIds.has(playerId) || isWon) return;
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
    const target = guesses.find((g) => g.isCorrect)?.targetDetails;
    if (!target) return;
    const lines = [
      `Players Game · ${date}`,
      `${target.name} em ${tries} ${tries === 1 ? 'tentativa' : 'tentativas'}`,
      '',
      ...guesses
        .slice()
        .reverse()
        .map((g) => {
          const matches = ATTRIBUTE_ORDER.filter((k) => g.breakdown[k]?.matched).length;
          const total = ATTRIBUTE_ORDER.length;
          return `${'🟩'.repeat(matches)}${'⬛'.repeat(total - matches)}`;
        }),
    ];
    navigator.clipboard.writeText(lines.join('\n'));
  }

  return (
    <main className="relative mx-auto max-w-5xl px-5 pb-24 pt-10 sm:px-8">
      <Header date={date} tries={tries} won={isWon} />

      <div className="hairline mt-8" />

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
        <div className="mt-6 border border-red-900/50 bg-red-950/30 px-4 py-3">
          <span className="eyebrow text-red-400">erro</span>
          <p className="mt-1 text-sm text-red-200">{error}</p>
        </div>
      )}

      {isWon && (
        <WinPanel
          guesses={guesses}
          target={guesses.find((g) => g.isCorrect)!.targetDetails!}
          onShare={copyShareText}
        />
      )}

      <div className="mt-10 flex flex-col gap-6">
        {guesses.map((g, i) => (
          <GuessCard
            key={`${g.guess.id}-${i}`}
            guess={g}
            attemptNo={tries - i}
            justAdded={i === 0}
          />
        ))}
      </div>

      {!guesses.length && !error && <EmptyState />}

      <Footer />
    </main>
  );
}

/* ─────────────────────────────────────────────── HEADER ──── */

function Header({ date, tries, won }: { date: string | null; tries: number; won: boolean }) {
  const triesPrev = useRef(tries);
  const [bump, setBump] = useState(false);
  useEffect(() => {
    if (tries !== triesPrev.current) {
      triesPrev.current = tries;
      setBump(true);
      const t = setTimeout(() => setBump(false), 500);
      return () => clearTimeout(t);
    }
  }, [tries]);

  return (
    <header className="grid grid-cols-12 items-end gap-4">
      <div className="col-span-7 sm:col-span-8">
        <span className="eyebrow inline-flex items-center gap-2">
          <span className="inline-block h-1.5 w-1.5 bg-[var(--color-signal)]" />
          edição diária · n.º {date ? new Date(date).getTime() % 1000 : '...'}
        </span>
        <h1 className="display mt-3 text-[clamp(2.6rem,8vw,5.6rem)]">
          Players<span className="display-italic text-[var(--color-signal)]">.</span>
        </h1>
        <p className="mt-2 text-sm text-[var(--color-mute)]">
          Adivinhe o jogador do dia. Cada palpite revela como ele se aproxima do alvo.
        </p>
      </div>
      <div className="col-span-5 sm:col-span-4">
        <div className="flex flex-col items-end">
          <span className="eyebrow">tentativas</span>
          <span
            className={`num mt-1 text-[clamp(3.2rem,10vw,6rem)] font-medium leading-none tabular-nums ${
              won ? 'text-[var(--color-signal)]' : 'text-[var(--color-paper)]'
            } ${bump ? 'counter-pulse' : ''}`}
            aria-live="polite"
          >
            {String(tries).padStart(2, '0')}
          </span>
          <span className="eyebrow mt-1.5 text-[var(--color-mute-2)]">
            {date ? formatPtDate(date) : '· · ·'}
          </span>
        </div>
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
  return (
    <section className="mt-6">
      <span className="eyebrow">próximo palpite</span>
      <div className="relative mt-2">
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
          placeholder="digite um nome..."
          className="display w-full border-b-2 border-[var(--color-line-strong)] bg-transparent pb-3 pt-1 text-2xl tracking-tight text-[var(--color-paper)] outline-none transition-colors placeholder:text-[var(--color-mute-2)] focus:border-[var(--color-signal)] sm:text-3xl"
          disabled={loading}
          autoComplete="off"
          spellCheck={false}
        />
        {loading && (
          <span className="num absolute right-0 top-1/2 -translate-y-1/2 text-xs text-[var(--color-signal)]">
            buscando…
          </span>
        )}
        {showDropdown && results.length > 0 && (
          <ul className="scroll-custom absolute left-0 right-0 top-full z-20 mt-2 max-h-[420px] overflow-y-auto border border-[var(--color-line-strong)] bg-[var(--color-ink-2)] shadow-2xl">
            {results.map((r, i) => {
              const used = guessedIds.has(r.id);
              const active = i === activeIdx;
              return (
                <li
                  key={r.id}
                  className={`flex cursor-pointer items-center gap-4 border-l-2 px-4 py-3 transition-colors ${
                    active
                      ? 'border-[var(--color-signal)] bg-[var(--color-ink-3)]'
                      : 'border-transparent hover:bg-[var(--color-ink-3)]/60'
                  } ${used ? 'opacity-35' : ''}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    if (!used) onSubmit(r.id);
                  }}
                  onMouseEnter={() => setActiveIdx(i)}
                >
                  <PlayerThumb url={r.photoUrl} size={40} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-base font-medium text-[var(--color-paper)]">
                      {r.name}
                    </div>
                    <div className="num truncate text-[11px] uppercase tracking-wider text-[var(--color-mute)]">
                      {[r.currentClubName, r.citizenship].filter(Boolean).join(' · ') || '—'}
                    </div>
                  </div>
                  {used && (
                    <span className="eyebrow text-[var(--color-mute-2)]">tentado</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────── GUESS CARD ──── */

function GuessCard({
  guess,
  attemptNo,
  justAdded,
}: {
  guess: GuessResponse;
  attemptNo: number;
  justAdded: boolean;
}) {
  const pct = Math.round((guess.totalScore / MAX_TOTAL_SCORE) * 100);

  return (
    <article
      className={`relative border border-[var(--color-line)] bg-[var(--color-ink-2)] ${
        justAdded ? 'guess-enter' : ''
      } ${guess.isCorrect ? 'win-flash border-[var(--color-signal)]' : ''}`}
    >
      <span className="corner-mark tl" />
      <span className="corner-mark tr" />
      <span className="corner-mark bl" />
      <span className="corner-mark br" />

      {/* Card header — scoreline */}
      <div className="grid grid-cols-12 items-center gap-3 border-b border-[var(--color-line)] px-5 py-4">
        <div className="col-span-1 hidden sm:block">
          <span className="num text-xs text-[var(--color-mute-2)]">
            #{String(attemptNo).padStart(2, '0')}
          </span>
        </div>
        <div className="col-span-8 flex items-center gap-3 sm:col-span-7">
          <PlayerThumb url={guess.guess.photoUrl} size={52} ring={guess.isCorrect} />
          <div className="min-w-0">
            <div className="truncate text-lg font-medium tracking-tight">{guess.guess.name}</div>
            <div className="eyebrow mt-0.5">
              {guess.isCorrect ? (
                <span className="text-[var(--color-signal)]">acerto · alvo do dia</span>
              ) : (
                <span>palpite #{String(attemptNo).padStart(2, '0')}</span>
              )}
            </div>
          </div>
        </div>
        <div className="col-span-4 text-right">
          <div className="num leading-none">
            <span
              className={`text-3xl font-medium tabular-nums sm:text-4xl ${
                guess.isCorrect ? 'text-[var(--color-signal)]' : 'text-[var(--color-paper)]'
              }`}
            >
              {guess.totalScore.toLocaleString('pt-BR')}
            </span>
            <span className="ml-1 text-xs text-[var(--color-mute-2)]">
              / {MAX_TOTAL_SCORE.toLocaleString('pt-BR')}
            </span>
          </div>
          <div className="eyebrow mt-1">
            <span className="text-[var(--color-mute)]">
              <span className="num">{pct}</span>%
            </span>
          </div>
        </div>
      </div>

      {/* Tiles grid */}
      <div className="grid grid-cols-2 gap-px bg-[var(--color-line)] sm:grid-cols-4 lg:grid-cols-7">
        {ATTRIBUTE_ORDER.map((key, i) => (
          <AttrTile
            key={key}
            label={ATTRIBUTE_LABELS[key]}
            cell={guess.breakdown[key]}
            delay={justAdded ? i * 35 : 0}
            justAdded={justAdded}
          />
        ))}
      </div>
    </article>
  );
}

function AttrTile({
  label,
  cell,
  delay,
  justAdded,
}: {
  label: string;
  cell: AttrCell | undefined;
  delay: number;
  justAdded: boolean;
}) {
  if (!cell) return null;
  const matched = cell.matched;
  const value = cell.guessValue ?? '—';

  const bg = matched
    ? 'bg-[var(--color-signal-deep)]'
    : cell.hint
      ? 'bg-[var(--color-warm-deep)]/40'
      : 'bg-[var(--color-ink-2)]';
  const labelColor = matched ? 'text-[var(--color-signal)]' : 'text-[var(--color-mute)]';
  const valueColor = matched
    ? 'text-[var(--color-paper)]'
    : cell.hint
      ? 'text-[var(--color-warm)]'
      : 'text-[var(--color-paper-dim)]';
  const scoreColor = matched ? 'text-[var(--color-signal)]' : 'text-[var(--color-mute-2)]';

  return (
    <div
      className={`relative flex min-h-[88px] flex-col justify-between px-3 py-2.5 ${bg} ${
        justAdded ? 'tile-rise' : ''
      }`}
      style={justAdded ? { animationDelay: `${delay}ms` } : undefined}
      title={`${label}: ${value} ${matched ? `(+${cell.weight})` : ''}`}
    >
      <div className={`eyebrow ${labelColor}`}>{label}</div>
      <div
        className={`mt-1 truncate font-display text-[15px] leading-tight tracking-tight ${valueColor}`}
      >
        {value}
        {cell.hint && (
          <span
            className="num ml-1 inline-block text-[var(--color-warm)]"
            aria-label={cell.hint === 'higher' ? 'alvo é maior' : 'alvo é menor'}
          >
            {cell.hint === 'higher' ? '↑' : '↓'}
          </span>
        )}
      </div>
      <div className={`num mt-0.5 text-[10px] tracking-wider ${scoreColor}`}>
        {matched ? `+${cell.weight}` : '—'}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────── WIN PANEL ──── */

function WinPanel({
  guesses,
  target,
  onShare,
}: {
  guesses: GuessResponse[];
  target: TargetDetails;
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
    <section className="relative mt-8 border border-[var(--color-signal)]/40 bg-gradient-to-br from-[var(--color-signal-deep)]/40 to-transparent">
      <span className="corner-mark tl" />
      <span className="corner-mark tr" />
      <span className="corner-mark bl" />
      <span className="corner-mark br" />

      <div className="grid gap-8 px-6 py-10 sm:grid-cols-12 sm:px-10">
        <div className="sm:col-span-7">
          <span className="eyebrow text-[var(--color-signal)]">manchete</span>
          <h2 className="display mt-2 text-[clamp(2.4rem,7vw,4.5rem)]">
            Acertou<span className="display-italic text-[var(--color-signal)]">.</span>
          </h2>
          <p className="mt-4 max-w-md text-[var(--color-paper-dim)]">
            <span className="display-italic text-[var(--color-paper)]">{target.name}</span>
            {' — '}
            o jogador do dia, descoberto em{' '}
            <span className="num text-[var(--color-signal)]">{tries}</span>{' '}
            {tries === 1 ? 'tentativa' : 'tentativas'}.
          </p>

          <button
            onClick={handleShare}
            className="num mt-8 inline-flex items-center gap-2 border border-[var(--color-signal)] px-5 py-3 text-xs uppercase tracking-[0.18em] text-[var(--color-signal)] transition hover:bg-[var(--color-signal)] hover:text-[var(--color-ink)]"
          >
            <span>{copied ? 'copiado ✓' : 'copiar resultado'}</span>
            <span aria-hidden>↗</span>
          </button>
        </div>

        <div className="sm:col-span-5">
          <div className="flex items-start gap-4">
            <PlayerThumb url={target.photoUrl} size={96} ring />
            <div className="flex-1">
              <div className="eyebrow text-[var(--color-mute)]">alvo · revelado</div>
              <div className="display mt-1 text-2xl">{target.name}</div>
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5 text-xs">
                <Detail label="clube" value={target.currentClubName} />
                <Detail label="liga" value={target.currentLeagueName} />
                <Detail label="seleção" value={target.countryOfCitizenshipName} />
                <Detail label="posição" value={target.primaryPosition} />
                <Detail label="nasc." value={target.dob} />
                <Detail
                  label="valor"
                  value={
                    target.marketValueEur
                      ? `€${(Number(target.marketValueEur) / 1_000_000).toFixed(0)}M`
                      : null
                  }
                />
              </dl>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="eyebrow text-[var(--color-mute-2)]">{label}</dt>
      <dd className="mt-0.5 truncate font-display text-[var(--color-paper)]" title={value ?? ''}>
        {value ?? '—'}
      </dd>
    </div>
  );
}

/* ─────────────────────────────────────────────── EMPTY / FOOTER ──── */

function EmptyState() {
  return (
    <div className="mt-12 grid grid-cols-12 gap-4">
      <div className="col-span-12 sm:col-span-7">
        <span className="eyebrow">como jogar</span>
        <p className="display mt-3 text-2xl leading-tight text-[var(--color-paper-dim)] sm:text-3xl">
          Cada palpite acende as categorias{' '}
          <span className="display-italic text-[var(--color-signal)]">em comum</span> com o alvo do
          dia. Quanto mais perto, mais pontos. Quanto menos tentativas, melhor.
        </p>
      </div>
      <div className="col-span-12 grid grid-cols-3 gap-px bg-[var(--color-line)] sm:col-span-5">
        {[
          ['CLUBE', '+1000'],
          ['SELEÇÃO', '+400'],
          ['POSIÇÃO', '+300'],
          ['LIGA', '+200'],
          ['ERA', '+200'],
          ['IDADE', '+100'],
        ].map(([k, v]) => (
          <div
            key={k}
            className="flex flex-col gap-1 bg-[var(--color-ink-2)] p-3"
          >
            <span className="eyebrow">{k}</span>
            <span className="num text-sm text-[var(--color-signal)]">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Footer() {
  return (
    <footer className="mt-20 flex items-center justify-between border-t border-[var(--color-line)] pt-6 text-[var(--color-mute-2)]">
      <span className="eyebrow">players game · 2026</span>
      <span className="num text-[10px] uppercase tracking-wider">
        dados · transfermarkt
      </span>
    </footer>
  );
}

/* ─────────────────────────────────────────────── MISC ──── */

function PlayerThumb({
  url,
  size,
  ring = false,
}: {
  url: string | null;
  size: number;
  ring?: boolean;
}) {
  return (
    <div
      className={`relative shrink-0 overflow-hidden bg-[var(--color-ink-3)] ${
        ring ? 'ring-2 ring-[var(--color-signal)] ring-offset-2 ring-offset-[var(--color-ink-2)]' : ''
      }`}
      style={{ width: size, height: size }}
    >
      {url ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover grayscale-[15%]"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
      ) : (
        <div className="h-full w-full bg-[var(--color-ink-3)]" />
      )}
    </div>
  );
}
