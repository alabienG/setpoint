import { Match, MatchRules, Pool, Team, Tournament } from '../core/models';
import { buildBracket, resolveBracket, roundName } from './bracket';
import {
  chunkIntoPools,
  distributeIntoPools,
  orderForDraw,
  poolRotations,
  rebalancePools,
  roundRobin,
  schedule,
  splitBySizes,
  startMinutes,
} from './draw';
import {
  MIXER_MAX_TEAMS,
  MIXER_MIN_TEAMS,
  MIXER_PHASES,
  formatName,
  mixerMatchesPerStage,
  mixerPoolCount,
  mixerPoolSizes,
} from './formats';
import { TeamStats, comparePointsScored, compareStats, computeStats, emptySets, standings, winnerSide } from './scoring';

export interface DrawResult {
  pools: Pool[];
  matches: Match[];
}

const AVAILABLE_FORMATS = ['pools', 'mixer', 'elim', 'league'];

/** Règles d'un match : celles de sa phase en « Poules brassées », sinon celles du tournoi. */
export function matchRules(t: Tournament, match: Match): MatchRules {
  if (t.format === 'mixer' && match.stage) return t.settings.phases[match.stage - 1] ?? t.settings;
  return t.settings;
}

function rulesSource(t: Tournament): (match: Match) => MatchRules {
  return (match) => matchRules(t, match);
}

/** Problèmes empêchant de lancer le tirage. */
export function drawBlockers(t: Tournament): string[] {
  const errors: string[] = [];
  const n = t.teams.length;
  const s = t.settings;
  if (!AVAILABLE_FORMATS.includes(t.format)) {
    errors.push(`Le format « ${formatName(t.format)} » n’est pas encore disponible.`);
  }
  if (n < 2) errors.push('Inscrivez au moins 2 équipes.');
  if (t.format === 'mixer' && (n < MIXER_MIN_TEAMS || n > MIXER_MAX_TEAMS)) {
    errors.push(`Le format « Poules brassées » se joue de ${MIXER_MIN_TEAMS} à ${MIXER_MAX_TEAMS} équipes (${n} inscrites).`);
  }
  if (t.format === 'pools') {
    if (s.poolCount < 1) errors.push('Il faut au moins une poule.');
    else if (n < s.poolCount * 2) errors.push(`Il faut au moins ${s.poolCount * 2} équipes pour ${s.poolCount} poules.`);
    else if (s.qualifiersPerPool > Math.floor(n / s.poolCount)) {
      errors.push('Il y a plus de qualifiés par poule que d’équipes dans la plus petite poule.');
    }
    if (s.qualifiersPerPool < 1 || s.poolCount * s.qualifiersPerPool < 2) {
      errors.push('La phase finale doit réunir au moins 2 équipes.');
    }
  }
  return errors;
}

function newMatch(
  id: string,
  partial: Pick<Match, 'phase' | 'round' | 'label' | 'pool' | 'stage'>,
  a: string,
  b: string,
  rules: MatchRules,
): Match {
  return {
    id,
    ...partial,
    a: { teamId: a },
    b: { teamId: b },
    slot: -1,
    court: 0,
    sets: emptySets(rules),
    status: 'todo',
  };
}

/** Matchs d'une phase de « Poules brassées », programmés à la suite des phases précédentes. */
function mixerStageMatches(t: Tournament, pools: Pool[], stage: number): Match[] {
  const rules = t.settings.phases[stage - 1];
  const matches: Match[] = [];
  const rotations = pools.map((p) => poolRotations(p.teamIds));
  for (let r = 0; r < 3; r++) {
    pools.forEach((p, i) => {
      rotations[i][r].forEach(([a, b], k) =>
        matches.push(
          newMatch(`s${stage}-${p.letter}-${r + 1}${k + 1}`, { phase: 'pool', pool: p.letter, stage, round: r + 1, label: `Poule ${p.letter}` }, a, b, rules),
        ),
      );
    });
  }
  const previous = t.matches.filter((m) => m.slot >= 0);
  const firstSlot = previous.length ? Math.max(...previous.map((m) => m.slot)) + 1 : 0;
  const phaseStart = previous.length
    ? Math.max(...previous.map((m) => (m.start ?? 0) + (t.settings.phases[(m.stage ?? 1) - 1]?.minutes ?? 0)))
    : startMinutes(t.settings);
  return schedule(matches, t.settings, firstSlot).map((m) => ({ ...m, start: phaseStart + (m.slot - firstSlot) * rules.minutes }));
}

/** Calcule le tirage (poules et rencontres) sans rien enregistrer : sert à l'aperçu et à la validation. */
export function generateDraw(t: Tournament): DrawResult {
  const ordered = orderForDraw(t.teams, t.drawMode, t.drawSeed).map((team) => team.id);
  let counter = 0;
  const nextId = () => `m${++counter}`;

  switch (t.format) {
    case 'mixer': {
      const pools = chunkIntoPools(ordered, mixerPoolCount(ordered.length), 1).map((p) => ({ ...p, name: `Niveau ${p.letter}` }));
      return { pools, matches: mixerStageMatches({ ...t, matches: [] }, pools, 1) };
    }
    case 'pools': {
      const pools = distributeIntoPools(ordered, t.settings.poolCount);
      const perPool = pools.map((p) => roundRobin(p.teamIds));
      const rounds = Math.max(...perPool.map((r) => r.length));
      const matches: Match[] = [];
      for (let r = 0; r < rounds; r++) {
        perPool.forEach((poolRounds, i) => {
          for (const [a, b] of poolRounds[r] ?? []) {
            const letter = pools[i].letter;
            matches.push(
              newMatch(nextId(), { phase: 'pool', pool: letter, round: r + 1, label: `Poule ${letter}` }, a, b, t.settings),
            );
          }
        });
      }
      return { pools, matches: schedule(matches, t.settings) };
    }
    case 'league': {
      const matches = roundRobin(ordered).flatMap((pairs, r) =>
        pairs.map(([a, b]) =>
          newMatch(nextId(), { phase: 'league', round: r + 1, label: `Journée ${r + 1}` }, a, b, t.settings),
        ),
      );
      return { pools: [], matches: schedule(matches, t.settings) };
    }
    case 'elim':
      return {
        pools: [],
        matches: schedule(resolveBracket(buildBracket(ordered, t.settings, 'm'), t.settings), t.settings),
      };
    default:
      return { pools: [], matches: [] };
  }
}

/** Classement d'une poule. En « Poules brassées », il se fait au total de points marqués, puis à la confrontation directe. */
export function poolStandings(t: Tournament, pool: Pool): TeamStats[] {
  return standings(
    pool.teamIds,
    t.matches.filter((m) => m.phase === 'pool' && m.pool === pool.letter && m.stage === pool.stage),
    rulesSource(t),
    t.format === 'mixer' ? comparePointsScored : compareStats,
  );
}

export function leagueStandings(t: Tournament): TeamStats[] {
  return standings(t.teams.map((team) => team.id), t.matches.filter((m) => m.phase === 'league'), rulesSource(t));
}

export function hasBracket(t: Tournament): boolean {
  return t.matches.some((m) => m.phase === 'bracket');
}

/** Dernière phase générée (« Poules brassées »). */
export function currentStage(t: Tournament): number {
  return Math.max(0, ...t.matches.map((m) => m.stage ?? 0));
}

export function stagePools(t: Tournament, stage: number): Pool[] {
  return t.pools.filter((p) => p.stage === stage);
}

function stageComplete(t: Tournament, stage: number): boolean {
  const matches = t.matches.filter((m) => m.stage === stage);
  return matches.length > 0 && matches.every((m) => m.status === 'done');
}

export function poolPhaseComplete(t: Tournament): boolean {
  const poolMatches = t.matches.filter((m) => m.phase === 'pool');
  return poolMatches.length > 0 && poolMatches.every((m) => m.status === 'done');
}

export function canGenerateFinals(t: Tournament): boolean {
  return t.format === 'pools' && t.stage === 'running' && poolPhaseComplete(t) && !hasBracket(t);
}

export function canGenerateNextStage(t: Tournament): boolean {
  const stage = currentStage(t);
  return t.format === 'mixer' && t.stage === 'running' && stage < MIXER_PHASES && stageComplete(t, stage);
}

/** Prochaine étape à déclencher par l'organisateur, s'il y en a une. */
export function nextStep(t: Tournament): { title: string; text: string; action: string } | null {
  if (canGenerateFinals(t)) {
    return {
      title: 'Phase de poules terminée',
      text: 'Les qualifiés sont connus : générez le tableau de la phase finale.',
      action: 'Générer la phase finale',
    };
  }
  if (canGenerateNextStage(t)) {
    const stage = currentStage(t);
    return {
      title: `Phase ${stage} terminée`,
      text: stage === 1 ? mixerStageNote(t, 1) : `Dernière phase : ses poules donnent le classement final de 1 à ${t.teams.length}.`,
      action: `Générer la phase ${stage + 1}`,
    };
  }
  return null;
}

/** Règle de passage vers la phase suivante, à afficher sous le classement d'une poule. */
export function mixerStageNote(t: Tournament, stage: number): string {
  const twelve = stagePools(t, 1).length === 3;
  if (stage === 1) {
    return twelve
      ? 'Phase 2 par rang : les 1ers et le 2e de la poule 1 en principale, puis intermédiaire, puis consolante.'
      : 'Les 2 premiers de chaque poule vont en principale, les 2 derniers en consolante.';
  }
  if (stage === 2) {
    return twelve
      ? 'Phase 3 : le 4e de chaque poule descend, le 1er de la poule suivante monte.'
      : 'Les 2 premiers jouent la poule de classement supérieure en phase 3.';
  }
  return 'Cette poule donne directement les places du classement final.';
}

/**
 * Composition des poules de la phase suivante.
 * 4 poules : modèle de brassage de l'organisateur (principale / consolante, puis places 1-4 à 13-16).
 * 3 poules : phase 2 par rang (1ers, 2es, 3es, 4es), puis montée / descente entre poules voisines.
 * Avec des poules de 3, les places du modèle qui n'existent pas (« 4e de la poule 4 ») restent vides,
 * puis les poules sont rééquilibrées pour compter au moins 3 équipes.
 */
export function generateNextStage(t: Tournament): DrawResult {
  const stage = currentStage(t);
  const r = stagePools(t, stage).map((p) => poolStandings(t, p).map((row) => row.teamId));
  const next = stage + 1;
  let names: string[];
  let seats: (string | undefined)[][];

  if (r.length === 3) {
    if (stage === 1) {
      const byRank = [0, 1, 2, 3].flatMap((rank) => r.map((ranks) => ranks[rank])).filter((id) => id !== undefined);
      names = ['Principale', 'Intermédiaire', 'Consolante'];
      seats = splitBySizes(byRank, mixerPoolSizes(byRank.length));
    } else {
      names = [];
      seats = [
        [r[0][0], r[0][1], r[0][2], r[1][0]],
        [r[0][3], r[1][1], r[1][2], r[2][0]],
        [r[1][3], r[2][1], r[2][2], r[2][3]],
      ];
    }
  } else if (stage === 1) {
    names = ['Principale', 'Principale', 'Consolante', 'Consolante'];
    seats = [
      [r[0][0], r[2][0], r[1][1], r[3][1]],
      [r[1][0], r[3][0], r[2][1], r[0][1]],
      [r[0][2], r[2][2], r[1][3], r[3][3]],
      [r[1][2], r[3][2], r[0][3], r[2][3]],
    ];
  } else {
    names = [];
    seats = [
      [r[0][0], r[0][1], r[1][0], r[1][1]],
      [r[0][2], r[1][2], r[0][3], r[1][3]],
      [r[2][0], r[3][0], r[2][1], r[3][1]],
      [r[2][2], r[3][2], r[2][3], r[3][3]],
    ];
  }

  const teamIds = rebalancePools(seats.map((s) => s.filter((id): id is string => id !== undefined)));
  let place = 1;
  const pools = teamIds.map((ids, i): Pool => {
    // En phase 3, chaque poule attribue un bloc de places du classement final.
    const name = names[i] ?? `Places ${place} à ${place + ids.length - 1}`;
    place += ids.length;
    return { letter: String(i + 1), name, stage: next, teamIds: ids };
  });
  return { pools, matches: mixerStageMatches(t, pools, next) };
}

/** Qualifiés de la phase de poules, classés : tous les 1ers, puis tous les 2es… */
export function poolQualifiers(t: Tournament): string[] {
  const tables = t.pools.map((p) => poolStandings(t, p));
  const ids: string[] = [];
  for (let rank = 0; rank < t.settings.qualifiersPerPool; rank++) {
    for (const table of tables) {
      if (table[rank]) ids.push(table[rank].teamId);
    }
  }
  return ids;
}

/** Étiquette de provenance (« A1 », « B2 ») des équipes qualifiées. */
export function qualifierTags(t: Tournament): Map<string, string> {
  const tags = new Map<string, string>();
  if (t.format !== 'pools' || !poolPhaseComplete(t)) return tags;
  t.pools.forEach((p) => poolStandings(t, p).forEach((row, i) => tags.set(row.teamId, `${p.letter}${i + 1}`)));
  return tags;
}

export function generateFinals(t: Tournament): Match[] {
  const lastSlot = Math.max(-1, ...t.matches.map((m) => m.slot));
  const bracket = resolveBracket(buildBracket(poolQualifiers(t), t.settings, 'f'), t.settings);
  return schedule(bracket, t.settings, lastSlot + 1);
}

export function isFinished(t: Tournament): boolean {
  if (t.matches.length === 0) return false;
  if (t.format === 'league') return t.matches.every((m) => m.status === 'done');
  if (t.format === 'mixer') return currentStage(t) === MIXER_PHASES && stageComplete(t, MIXER_PHASES);
  const bracket = t.matches.filter((m) => m.phase === 'bracket');
  return bracket.length > 0 && bracket.every((m) => m.status === 'done');
}

/** À appeler après chaque modification : fait avancer le tableau et clôt le tournoi si besoin. */
export function normalize(t: Tournament): Tournament {
  let next = t;
  if (hasBracket(next)) next = { ...next, matches: resolveBracket(next.matches, next.settings) };
  if (next.stage === 'running' && isFinished(next)) next = { ...next, stage: 'finished' };
  return next;
}

export function playableMatches(t: Tournament): Match[] {
  return t.matches.filter((m) => !m.bye);
}

export function matchWinnerId(t: Tournament, m: Match): string | null {
  if (m.status !== 'done') return null;
  const side = winnerSide(m, matchRules(t, m));
  return side ? m[side].teamId : null;
}

export interface RankingRow extends TeamStats {
  rank: number;
  team: Team;
  journey: string;
}

/** Classement final (provisoire tant que le tournoi n'est pas terminé). */
export function finalRanking(t: Tournament): RankingRow[] {
  const teamsById = new Map(t.teams.map((team) => [team.id, team]));
  const stats = computeStats(t.teams.map((team) => team.id), t.matches, rulesSource(t));
  const tier = new Map<string, number>();
  const journey = new Map<string, string>();

  if (t.format === 'mixer') {
    // Les poules de la dernière phase jouée sont rangées de la meilleure à la moins bonne.
    let offset = 0;
    for (const p of stagePools(t, currentStage(t))) {
      poolStandings(t, p).forEach((row, rank) => {
        tier.set(row.teamId, offset + rank);
        journey.set(row.teamId, `Phase ${p.stage} · Poule ${p.letter}${p.name ? ` (${p.name})` : ''}`);
      });
      offset += p.teamIds.length;
    }
  } else if (t.format === 'league') {
    leagueStandings(t).forEach((row, i) => {
      tier.set(row.teamId, i);
      journey.set(row.teamId, i === 0 && t.stage === 'finished' ? 'Champion' : `${row.rankingPoints} pts`);
    });
  } else {
    t.pools.forEach((p) =>
      poolStandings(t, p).forEach((row, i) => {
        tier.set(row.teamId, 100 + i);
        journey.set(row.teamId, 'Phase de poules');
      }),
    );
    const bracket = t.matches.filter((m) => m.phase === 'bracket');
    const lastRound = Math.max(0, ...bracket.map((m) => m.round));
    for (const m of bracket.filter((x) => !x.kind)) {
      for (const id of [m.a.teamId, m.b.teamId]) {
        if (!id) continue;
        const value = 10 + lastRound - m.round;
        if (value < (tier.get(id) ?? Infinity)) {
          tier.set(id, value);
          journey.set(id, `Éliminé en ${roundName(2 ** (lastRound - m.round + 1)).toLowerCase()}`);
        }
      }
    }
    const placements: [Match | undefined, string, string, number][] = [
      [bracket.find((m) => m.kind === 'final'), 'Champion', 'Finaliste', 0],
      [bracket.find((m) => m.kind === 'third'), '3e place', 'Demi-finaliste', 2],
    ];
    for (const [match, winLabel, loseLabel, base] of placements) {
      if (!match || match.status !== 'done' || match.bye) continue;
      const won = winnerSide(match, t.settings);
      if (!won) continue;
      const winner = match[won].teamId!;
      const loser = match[won === 'a' ? 'b' : 'a'].teamId!;
      tier.set(winner, base);
      journey.set(winner, winLabel);
      tier.set(loser, base + 1);
      journey.set(loser, loseLabel);
    }
  }

  return [...stats.values()]
    .sort((x, y) => (tier.get(x.teamId) ?? 1000) - (tier.get(y.teamId) ?? 1000) || compareStats(x, y))
    .map((row, i) => ({
      ...row,
      rank: i + 1,
      team: teamsById.get(row.teamId)!,
      journey: journey.get(row.teamId) ?? '—',
    }));
}

export function progress(t: Tournament): { done: number; total: number } {
  const matches = playableMatches(t);
  // En « Poules brassées », les phases à venir comptent déjà dans le total.
  const upcoming =
    t.format === 'mixer' && t.stage !== 'setup' ? (MIXER_PHASES - currentStage(t)) * mixerMatchesPerStage(t.teams.length) : 0;
  return { done: matches.filter((m) => m.status === 'done').length, total: matches.length + upcoming };
}
