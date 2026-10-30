import { Match, MatchRules, SetScore, Side } from '../core/models';

export interface MatchResult {
  setsA: number;
  setsB: number;
  pointsA: number;
  pointsB: number;
  winner: Side | null;
}

export interface TeamStats {
  teamId: string;
  played: number;
  wins: number;
  losses: number;
  setsWon: number;
  setsLost: number;
  pointsFor: number;
  pointsAgainst: number;
  /** Points au classement : 3 victoire nette, 2 victoire au set décisif, 1 défaite au set décisif. */
  rankingPoints: number;
}

/** Règles applicables à chaque match : soit des règles fixes, soit une fonction par match. */
export type RulesSource = MatchRules | ((match: Match) => MatchRules);

function rulesOf(source: RulesSource, match: Match): MatchRules {
  return typeof source === 'function' ? source(match) : source;
}

export function maxSets(rules: MatchRules): number {
  return rules.setsToWin * 2 - 1;
}

export function isDecidingSet(index: number, rules: MatchRules): boolean {
  return maxSets(rules) > 1 && index === maxSets(rules) - 1;
}

export function setLabel(index: number, rules: MatchRules): string {
  if (maxSets(rules) === 1) return 'Score';
  return isDecidingSet(index, rules) ? 'Set décisif' : `Set ${index + 1}`;
}

export function setTarget(index: number, rules: MatchRules): number {
  return isDecidingSet(index, rules) ? rules.decidingSetPoints : rules.pointsPerSet;
}

/** Plafond du set : le set décisif garde le même écart entre score cible et plafond. */
export function setCap(index: number, rules: MatchRules): number | null {
  if (rules.cap === null) return null;
  return setTarget(index, rules) + (rules.cap - rules.pointsPerSet);
}

export function describeRules(rules: MatchRules): string {
  const sets = rules.setsToWin === 1 ? '1 set' : `${rules.setsToWin} sets gagnants`;
  const cap = rules.cap !== null ? `, plafond ${rules.cap}` : '';
  return `${sets} de ${rules.pointsPerSet} pts (2 pts d’écart${cap})`;
}

export function emptySets(rules: MatchRules): SetScore[] {
  return Array.from({ length: maxSets(rules) }, (): SetScore => [null, null]);
}

export function setWinner(score: SetScore, index: number, rules: MatchRules): Side | null {
  const [a, b] = score;
  if (a === null || b === null) return null;
  const target = setTarget(index, rules);
  const cap = setCap(index, rules);
  if ((a >= target && a - b >= 2) || (cap !== null && a >= cap && a > b)) return 'a';
  if ((b >= target && b - a >= 2) || (cap !== null && b >= cap && b > a)) return 'b';
  return null;
}

export function evaluateMatch(match: Match, rules: MatchRules): MatchResult {
  const result: MatchResult = { setsA: 0, setsB: 0, pointsA: 0, pointsB: 0, winner: null };
  match.sets.forEach((score, index) => {
    if (result.winner) return;
    result.pointsA += score[0] ?? 0;
    result.pointsB += score[1] ?? 0;
    const winner = setWinner(score, index, rules);
    if (winner === 'a') result.setsA++;
    if (winner === 'b') result.setsB++;
    if (result.setsA >= rules.setsToWin) result.winner = 'a';
    if (result.setsB >= rules.setsToWin) result.winner = 'b';
  });
  return result;
}

/** Côté vainqueur d'un match terminé (une exemption est gagnée par l'équipe présente). */
export function winnerSide(match: Match, rules: MatchRules): Side | null {
  if (match.bye) {
    if (match.a.teamId) return 'a';
    return match.b.teamId ? 'b' : null;
  }
  return evaluateMatch(match, rules).winner;
}

export function otherSide(side: Side): Side {
  return side === 'a' ? 'b' : 'a';
}

/** Index du premier set sans vainqueur, ou null si le match est décidé. */
export function currentSetIndex(match: Match, rules: MatchRules): number | null {
  if (evaluateMatch(match, rules).winner) return null;
  const index = match.sets.findIndex((score, i) => !setWinner(score, i, rules));
  return index === -1 ? null : index;
}

export function playedSets(match: Match): SetScore[] {
  return match.sets.filter((s) => s[0] !== null && s[1] !== null);
}

export function computeStats(
  teamIds: readonly string[],
  matches: readonly Match[],
  rulesSource: RulesSource,
): Map<string, TeamStats> {
  const stats = new Map<string, TeamStats>(
    teamIds.map((teamId) => [
      teamId,
      { teamId, played: 0, wins: 0, losses: 0, setsWon: 0, setsLost: 0, pointsFor: 0, pointsAgainst: 0, rankingPoints: 0 },
    ]),
  );
  for (const match of matches) {
    if (match.status !== 'done' || match.bye) continue;
    const a = match.a.teamId ? stats.get(match.a.teamId) : undefined;
    const b = match.b.teamId ? stats.get(match.b.teamId) : undefined;
    const rules = rulesOf(rulesSource, match);
    const result = evaluateMatch(match, rules);
    if (!a || !b || !result.winner) continue;
    a.played++;
    b.played++;
    a.setsWon += result.setsA;
    a.setsLost += result.setsB;
    b.setsWon += result.setsB;
    b.setsLost += result.setsA;
    a.pointsFor += result.pointsA;
    a.pointsAgainst += result.pointsB;
    b.pointsFor += result.pointsB;
    b.pointsAgainst += result.pointsA;
    const [winner, loser] = result.winner === 'a' ? [a, b] : [b, a];
    winner.wins++;
    loser.losses++;
    const decidingSet = maxSets(rules) > 1 && result.setsA + result.setsB === maxSets(rules);
    winner.rankingPoints += decidingSet ? 2 : 3;
    loser.rankingPoints += decidingSet ? 1 : 0;
  }
  return stats;
}

/** Points au classement, puis différence de sets, écart de points, points marqués, victoires. */
export function compareStats(x: TeamStats, y: TeamStats): number {
  return (
    y.rankingPoints - x.rankingPoints ||
    y.setsWon - y.setsLost - (x.setsWon - x.setsLost) ||
    y.pointsFor - y.pointsAgainst - (x.pointsFor - x.pointsAgainst) ||
    y.pointsFor - x.pointsFor ||
    y.wins - x.wins
  );
}

/** Classement à l'écart de points (points marqués − points encaissés), format « Poules brassées ». */
export function comparePointDifference(x: TeamStats, y: TeamStats): number {
  return y.pointsFor - y.pointsAgainst - (x.pointsFor - x.pointsAgainst);
}

/**
 * Classement d'un groupe selon `compare` ; deux équipes à égalité se départagent à la confrontation directe,
 * puis (égalité à trois ou plus) aux critères généraux.
 */
export function standings(
  teamIds: readonly string[],
  matches: readonly Match[],
  rulesSource: RulesSource,
  compare: (x: TeamStats, y: TeamStats) => number = compareStats,
): TeamStats[] {
  const headToHead = (x: TeamStats, y: TeamStats): number => {
    const match = matches.find(
      (m) =>
        m.status === 'done' &&
        !m.bye &&
        [m.a.teamId, m.b.teamId].includes(x.teamId) &&
        [m.a.teamId, m.b.teamId].includes(y.teamId),
    );
    if (!match) return 0;
    const side = evaluateMatch(match, rulesOf(rulesSource, match)).winner;
    const winner = side ? match[side].teamId : null;
    return winner === x.teamId ? -1 : winner === y.teamId ? 1 : 0;
  };
  return [...computeStats(teamIds, matches, rulesSource).values()].sort(
    (x, y) => compare(x, y) || headToHead(x, y) || compareStats(x, y),
  );
}
