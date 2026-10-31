import { Match, MatchRules, Pool, Team, Tournament } from '../core/models';
import { buildBracket, resolveBracket, roundName } from './bracket';
import {
  chunkIntoPools,
  distributeIntoPools,
  mixerRotations,
  orderForDraw,
  roundRobin,
  schedule,
  startMinutes,
} from './draw';
import { MIXER_PHASES, MIXER_SIZES, formatName, mixerMatchesPerStage, mixerPoolSize } from './formats';
import { assignReferees } from './referees';
import {
  TeamStats,
  comparePointDifference,
  compareStats,
  computeStats,
  emptySets,
  evaluateMatch,
  standings,
  winnerSide,
} from './scoring';

export interface DrawResult {
  pools: Pool[];
  matches: Match[];
}

const AVAILABLE_FORMATS = ['pools', 'mixer', 'elim', 'league'];

/** Règles d'un match : celles de sa phase en « Poules brassées », sinon celles du tournoi. */
export function matchRules(t: Tournament, match: Match): MatchRules {
  if (match.kind === 'tiebreak') return TIEBREAK_RULES;
  if (t.format === 'mixer' && match.stage) return t.settings.phases[match.stage - 1] ?? t.settings;
  return t.settings;
}

/** Barrage entre deux paires à égalité : 2 contre 2, la première à 6 points gagne. */
export const TIEBREAK_RULES: MatchRules = { setsToWin: 1, pointsPerSet: 6, decidingSetPoints: 6, cap: 6 };
/** Durée prévue d'un barrage, pour l'horaire affiché. */
const TIEBREAK_MINUTES = 10;

/**
 * Terrains utilisables en même temps. En auto-arbitrage, chaque match mobilise les équipes qui
 * jouent plus une qui arbitre (3 en 1 contre 1, 5 paires en 4 contre 4) : on ne programme pas
 * plus de matchs simultanés que le nombre d'équipes ne le permet.
 */
export function usableCourts(t: Tournament): number {
  if (!t.settings.selfRefereeing) return t.settings.courts;
  const perMatch = t.format === 'mixer' ? 5 : 3;
  return Math.max(1, Math.min(t.settings.courts, Math.floor(t.teams.length / perMatch)));
}

function schedulingSettings(t: Tournament) {
  return { ...t.settings, courts: usableCourts(t) };
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
  if (t.format === 'mixer' && !MIXER_SIZES.includes(n)) {
    errors.push(`Le format « Poules brassées » (4 contre 4) se joue à 12, 15 ou 16 paires (${n} inscrites).`);
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

/**
 * Matchs d'une phase de « Poules brassées » (4 contre 4 : deux paires par camp ; 3 matchs par
 * poule de 4, 5 par poule de 5), programmés à la suite des phases précédentes.
 */
function mixerStageMatches(t: Tournament, pools: Pool[], stage: number): Match[] {
  const rules = t.settings.phases[stage - 1];
  const matches: Match[] = [];
  const rotations = pools.map((p) => mixerRotations(p.teamIds));
  for (let r = 0; r < rotations[0].length; r++) {
    pools.forEach((p, i) => {
      const [[a1, a2], [b1, b2]] = rotations[i][r];
      matches.push({
        ...newMatch(`s${stage}-${p.letter}-${r + 1}`, { phase: 'pool', pool: p.letter, stage, round: r + 1, label: `Poule ${p.letter}` }, a1, b1, rules),
        a: { teamId: a1, partnerId: a2 },
        b: { teamId: b1, partnerId: b2 },
      });
    });
  }
  const previous = t.matches.filter((m) => m.slot >= 0);
  const firstSlot = previous.length ? Math.max(...previous.map((m) => m.slot)) + 1 : 0;
  const phaseStart = previous.length ? Math.max(...previous.map((m) => matchEnd(t, m))) : startMinutes(t.settings);
  return schedule(matches, schedulingSettings(t), firstSlot).map((m) => ({ ...m, start: phaseStart + (m.slot - firstSlot) * rules.minutes }));
}

/** Heure de fin prévue d'un match (poules brassées), en minutes depuis minuit. */
function matchEnd(t: Tournament, m: Match): number {
  const minutes = m.kind === 'tiebreak' ? TIEBREAK_MINUTES : (t.settings.phases[(m.stage ?? 1) - 1]?.minutes ?? 0);
  return (m.start ?? 0) + minutes;
}

/** Calcule le tirage (poules et rencontres) sans rien enregistrer : sert à l'aperçu et à la validation. */
export function generateDraw(t: Tournament): DrawResult {
  const ordered = orderForDraw(t.teams, t.drawMode, t.drawSeed).map((team) => team.id);
  let counter = 0;
  const nextId = () => `m${++counter}`;

  switch (t.format) {
    case 'mixer': {
      const pools = chunkIntoPools(ordered, ordered.length / mixerPoolSize(ordered.length), 1).map((p) => ({ ...p, name: `Niveau ${p.letter}` }));
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
      return { pools, matches: schedule(matches, schedulingSettings(t)) };
    }
    case 'league': {
      const matches = roundRobin(ordered).flatMap((pairs, r) =>
        pairs.map(([a, b]) =>
          newMatch(nextId(), { phase: 'league', round: r + 1, label: `Journée ${r + 1}` }, a, b, t.settings),
        ),
      );
      return { pools: [], matches: schedule(matches, schedulingSettings(t)) };
    }
    case 'elim':
      return {
        pools: [],
        matches: schedule(resolveBracket(buildBracket(ordered, t.settings, 'm'), t.settings), schedulingSettings(t)),
      };
    default:
      return { pools: [], matches: [] };
  }
}

/** Classement d'une poule. En « Poules brassées », il se fait à l'écart de points, puis à la confrontation directe. */
/**
 * Classement d'une poule. En « Poules brassées » : écart de points, puis barrages entre les paires
 * restées à égalité (les barrages ne comptent pas dans l'écart).
 */
export function poolStandings(t: Tournament, pool: Pool): TeamStats[] {
  const matches = t.matches.filter((m) => m.phase === 'pool' && m.pool === pool.letter && m.stage === pool.stage);
  const rows = standings(
    pool.teamIds,
    matches.filter((m) => m.kind !== 'tiebreak'),
    rulesSource(t),
    t.format === 'mixer' ? comparePointDifference : compareStats,
  );
  if (t.format !== 'mixer') return rows;
  const barrages = matches.filter((m) => m.kind === 'tiebreak');
  return tiedGroups(rows).flatMap((group) => (group.length > 1 ? rankByBarrages(group, barrages) : group));
}

/** Paires consécutives à égalité d'écart. */
function tiedGroups(rows: TeamStats[]): TeamStats[][] {
  const groups: TeamStats[][] = [];
  for (const row of rows) {
    const last = groups.at(-1);
    const diff = (r: TeamStats) => r.pointsFor - r.pointsAgainst;
    if (last && diff(last[0]) === diff(row)) last.push(row);
    else groups.push([row]);
  }
  return groups;
}

/** Classe des paires à égalité selon leurs barrages : victoires, puis écart (ordre conservé sinon). */
function rankByBarrages(group: TeamStats[], barrages: Match[]): TeamStats[] {
  const score = new Map(group.map((r) => [r.teamId, { wins: 0, diff: 0 }]));
  for (const m of barrages) {
    if (m.status !== 'done' || !score.has(m.a.teamId!) || !score.has(m.b.teamId!)) continue;
    const result = evaluateMatch(m, TIEBREAK_RULES);
    const a = score.get(m.a.teamId!)!;
    const b = score.get(m.b.teamId!)!;
    a.diff += result.pointsA - result.pointsB;
    b.diff += result.pointsB - result.pointsA;
    if (result.winner === 'a') a.wins++;
    if (result.winner === 'b') b.wins++;
  }
  return [...group].sort((x, y) => {
    const sx = score.get(x.teamId)!;
    const sy = score.get(y.teamId)!;
    return sy.wins - sx.wins || sy.diff - sx.diff;
  });
}

/**
 * Poules brassées : dès qu'une poule a joué ses 3 matchs, crée un barrage (2 contre 2, 6 points)
 * entre chaque couple de paires restées à égalité d'écart, programmé à la suite de la phase.
 */
function addTiebreaks(t: Tournament): Tournament {
  if (t.format !== 'mixer' || t.stage !== 'running') return t;
  const stage = currentStage(t);
  const created: Match[] = [];
  for (const pool of stagePools(t, stage)) {
    const regular = t.matches.filter((m) => m.stage === stage && m.pool === pool.letter && m.kind !== 'tiebreak');
    if (!regular.length || regular.some((m) => m.status !== 'done')) continue;
    const rows = standings(pool.teamIds, regular, rulesSource(t), comparePointDifference);
    for (const group of tiedGroups(rows).filter((g) => g.length > 1)) {
      group.forEach((x, i) =>
        group.slice(i + 1).forEach((y) => {
          const id = `s${stage}-${pool.letter}-barrage-${x.teamId}-${y.teamId}`;
          if (t.matches.some((m) => m.id === id)) return;
          created.push({
            ...newMatch(id, { phase: 'pool', pool: pool.letter, stage, round: 4, label: `Barrage poule ${pool.letter}` }, x.teamId, y.teamId, TIEBREAK_RULES),
            kind: 'tiebreak',
          });
        }),
      );
    }
  }
  if (!created.length) return t;
  const stageMatches = t.matches.filter((m) => m.stage === stage && m.slot >= 0);
  const firstSlot = Math.max(...t.matches.map((m) => m.slot)) + 1;
  const start = Math.max(...stageMatches.map((m) => matchEnd(t, m)));
  const scheduled = schedule(created, schedulingSettings(t), firstSlot).map((m) => ({ ...m, start: start + (m.slot - firstSlot) * TIEBREAK_MINUTES }));
  return { ...t, matches: [...t.matches, ...scheduled] };
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
  const threePools = stagePools(t, 1).length === 3;
  if (stage === 1) {
    return threePools
      ? 'Phase 2 par rang : tous les 1ers, puis les 2es, etc., répartis en principale, intermédiaire et consolante.'
      : 'Les 2 premiers de chaque poule vont en principale, les 2 derniers en consolante.';
  }
  if (stage === 2) {
    return threePools
      ? 'Phase 3 : le dernier de chaque poule descend, le 1er de la poule suivante monte.'
      : 'Les 2 premiers jouent la poule de classement supérieure en phase 3.';
  }
  return 'Cette poule donne directement les places du classement final.';
}

/**
 * Composition des poules de la phase suivante.
 * 16 paires (4 poules) : modèle de brassage de l'organisateur (principale / consolante, puis places 1-4 à 13-16).
 * 12 et 15 paires (3 poules de 4 ou de 5) : phase 2 par rang (tous les 1ers, puis les 2es…), puis
 * montée / descente entre poules voisines (le dernier d'une poule descend, le 1er de la suivante monte).
 */
export function generateNextStage(t: Tournament): DrawResult {
  const stage = currentStage(t);
  const r = stagePools(t, stage).map((p) => poolStandings(t, p).map((row) => row.teamId));
  const next = stage + 1;
  let names: string[];
  let seats: string[][];

  if (r.length === 3) {
    const k = r[0].length;
    if (stage === 1) {
      const byRank = Array.from({ length: k }, (_, rank) => r.map((ranks) => ranks[rank])).flat();
      names = ['Principale', 'Intermédiaire', 'Consolante'];
      seats = [byRank.slice(0, k), byRank.slice(k, 2 * k), byRank.slice(2 * k)];
    } else {
      names = [];
      seats = [
        [...r[0].slice(0, k - 1), r[1][0]],
        [r[0][k - 1], ...r[1].slice(1, k - 1), r[2][0]],
        [r[1][k - 1], ...r[2].slice(1)],
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

  let place = 1;
  const pools = seats.map((ids, i): Pool => {
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
  return schedule(bracket, schedulingSettings(t), lastSlot + 1);
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
  next = addTiebreaks(next);
  next = assignReferees(next);
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
  /** Poules brassées, à partir de la phase 2 : niveau de la paire (Principale, Places 1 à 4…). */
  level?: Level;
}

/** Niveau d'une poule de phase 2 ou 3 : nom et rang (0 = le plus haut), pour l'affichage. */
export interface Level {
  name: string;
  rank: number;
}

/**
 * Niveaux d'une phase de poules brassées (à partir de la phase 2), par poule. Les poules de même nom
 * (deux « Principale » à 16 paires) partagent le même niveau. Vide en phase 1 (poules « Niveau n »).
 */
export function stageLevels(t: Tournament, stage: number): Map<string, Level> {
  const levels = new Map<string, Level>();
  if (t.format !== 'mixer' || stage < 2) return levels;
  const names: string[] = [];
  for (const p of stagePools(t, stage)) {
    if (!p.name) continue;
    if (!names.includes(p.name)) names.push(p.name);
    levels.set(p.letter, { name: p.name, rank: names.indexOf(p.name) });
  }
  return levels;
}

/** Classement final (provisoire tant que le tournoi n'est pas terminé). */
export function finalRanking(t: Tournament): RankingRow[] {
  const teamsById = new Map(t.teams.map((team) => [team.id, team]));
  const stats = computeStats(t.teams.map((team) => team.id), t.matches, rulesSource(t));
  const tier = new Map<string, number>();
  const journey = new Map<string, string>();
  const level = new Map<string, Level>();

  if (t.format === 'mixer') {
    // Les poules de la dernière phase jouée sont rangées de la meilleure à la moins bonne.
    let offset = 0;
    const levels = stageLevels(t, currentStage(t));
    for (const p of stagePools(t, currentStage(t))) {
      poolStandings(t, p).forEach((row, rank) => {
        const poolLevel = levels.get(p.letter);
        if (poolLevel) level.set(row.teamId, poolLevel);
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
      ...(level.has(row.teamId) ? { level: level.get(row.teamId) } : {}),
    }));
}

export function progress(t: Tournament): { done: number; total: number } {
  const matches = playableMatches(t);
  // En « Poules brassées », les phases à venir comptent déjà dans le total.
  const upcoming =
    t.format === 'mixer' && t.stage !== 'setup' ? (MIXER_PHASES - currentStage(t)) * mixerMatchesPerStage(t.teams.length) : 0;
  return { done: matches.filter((m) => m.status === 'done').length, total: matches.length + upcoming };
}

/** Marque la première ligne de chaque niveau, pour y afficher un intertitre. */
export function withLevelStarts(rows: RankingRow[]): (RankingRow & { levelStart: boolean })[] {
  return rows.map((row, i) => ({
    ...row,
    levelStart: !!row.level && (i === 0 || rows[i - 1].level?.name !== row.level.name),
  }));
}
