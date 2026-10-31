import { DrawMode, LEVELS, Match, Pool, Team, TournamentSettings } from '../core/models';
import { shuffle } from './random';
import { matchTeams } from './scoring';

/** Ordonne les équipes avant répartition : les premières seront séparées au maximum. */
export function orderForDraw(teams: readonly Team[], mode: DrawMode, seed: number): Team[] {
  switch (mode) {
    case 'random':
      return shuffle(teams, seed);
    case 'seeds':
      return [
        ...shuffle(teams.filter((t) => t.seed), seed),
        ...shuffle(teams.filter((t) => !t.seed), seed + 1),
      ];
    case 'level':
      return shuffle(teams, seed).sort((x, y) => teamRating(y) - teamRating(x));
  }
}

/** Niveau chiffré d'une équipe (1 à 5) : saisi ou importé, sinon déduit du niveau Loisir / Intermédiaire / Avancé. */
export function teamRating(team: Team): number {
  return team.rating ?? LEVELS.indexOf(team.level) + 2;
}

export function poolLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

/** Répartition en serpentin : A B C, C B A, A B C… les têtes de liste tombent dans des poules différentes. */
export function distributeIntoPools(orderedIds: readonly string[], poolCount: number): Pool[] {
  const pools: Pool[] = Array.from({ length: poolCount }, (_, i) => ({ letter: poolLetter(i), teamIds: [] }));
  orderedIds.forEach((id, i) => {
    const row = Math.floor(i / poolCount);
    const col = i % poolCount;
    pools[row % 2 === 0 ? col : poolCount - 1 - col].teamIds.push(id);
  });
  return pools;
}

/** Tous contre tous (méthode du cercle) : une liste de journées, chacune une liste de rencontres. */
export function roundRobin<T>(items: readonly T[]): [T, T][][] {
  const list: (T | null)[] = [...items];
  if (list.length % 2 === 1) list.push(null);
  const n = list.length;
  const rounds: [T, T][][] = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs: [T, T][] = [];
    for (let i = 0; i < n / 2; i++) {
      const x = list[i];
      const y = list[n - 1 - i];
      if (x !== null && y !== null) pairs.push([x, y]);
    }
    rounds.push(pairs);
    list.splice(1, 0, list.pop()!);
  }
  return rounds;
}

/**
 * Affecte un créneau et un terrain à chaque match, dans l'ordre donné :
 * au plus un match par terrain et par créneau, une équipe ne joue pas deux fois dans le même créneau,
 * et un match de tableau passe après les matchs dont il dépend.
 */
export function schedule(matches: readonly Match[], settings: TournamentSettings, firstSlot = 0): Match[] {
  const slots: { teams: Set<string>; count: number }[] = [];
  const slotOf = new Map<string, number>();
  const courts = Math.max(1, settings.courts);

  return matches.map((match) => {
    if (match.bye) {
      slotOf.set(match.id, firstSlot - 1);
      return { ...match, slot: -1, court: 0 };
    }
    const teams = matchTeams(match);
    const after = [match.a.from, match.b.from]
      .map((from) => (from ? slotOf.get(from.matchId) : undefined))
      .filter((s): s is number => s !== undefined);
    let index = Math.max(0, ...after.map((s) => s + 1 - firstSlot));
    while (slots[index] && (slots[index].count >= courts || teams.some((t) => slots[index].teams.has(t)))) {
      index++;
    }
    slots[index] ??= { teams: new Set(), count: 0 };
    slots[index].count++;
    teams.forEach((t) => slots[index].teams.add(t));
    slotOf.set(match.id, firstSlot + index);
    return { ...match, slot: firstSlot + index, court: slots[index].count };
  });
}

export function startMinutes(settings: TournamentSettings): number {
  const [h, m] = settings.startTime.split(':').map(Number);
  return h * 60 + m;
}

export function formatMinutes(total: number): string {
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export function slotTime(slot: number, settings: TournamentSettings): string {
  if (slot < 0) return '';
  return formatMinutes(startMinutes(settings) + slot * settings.slotMinutes);
}

/** Heure d'un match : fixée à la programmation si les créneaux n'ont pas tous la même durée. */
export function matchTime(match: Match, settings: TournamentSettings): string {
  if (match.slot < 0) return '';
  return match.start !== undefined ? formatMinutes(match.start) : slotTime(match.slot, settings);
}

/** Découpe une liste en groupes consécutifs de tailles données. */
export function splitBySizes<T>(items: readonly T[], sizes: readonly number[]): T[][] {
  let start = 0;
  return sizes.map((size) => items.slice(start, (start += size)));
}

/**
 * Découpe en groupes consécutifs : les équipes de niveau proche se retrouvent ensemble.
 * Les poules les plus fortes reçoivent les équipes en plus (ex. 14 équipes → 4, 4, 3, 3).
 */
export function chunkIntoPools(orderedIds: readonly string[], poolCount: number, stage?: number): Pool[] {
  const base = Math.floor(orderedIds.length / poolCount);
  const extra = orderedIds.length % poolCount;
  const sizes = Array.from({ length: poolCount }, (_, i) => base + (i < extra ? 1 : 0));
  return splitBySizes(orderedIds, sizes).map((teamIds, i) => ({
    letter: String(i + 1),
    teamIds,
    ...(stage !== undefined ? { stage } : {}),
  }));
}

/**
 * Matchs d'une poule en 4 contre 4 (deux paires par camp).
 *
 * Poule de 4 : A+B / C+D, A+C / B+D, A+D / B+C. Chaque paire joue les trois matchs, avec un
 * partenaire différent à chaque fois.
 *
 * Poule de 5 : 5 matchs, une paire au repos à chacun. Chaque paire joue 4 matchs, se repose une
 * fois, est partenaire exactement une fois de chacune des 4 autres et affronte chacune deux fois.
 */
export function mixerRotations<T>(pairs: readonly T[]): [[T, T], [T, T]][] {
  if (pairs.length === 5) {
    const [p1, p2, p3, p4, p5] = pairs;
    return [
      [[p1, p2], [p3, p4]], // repos : 5
      [[p1, p3], [p2, p5]], // repos : 4
      [[p1, p5], [p2, p4]], // repos : 3
      [[p1, p4], [p3, p5]], // repos : 2
      [[p2, p3], [p4, p5]], // repos : 1
    ];
  }
  const [a, b, c, d] = pairs;
  return [
    [[a, b], [c, d]],
    [[a, c], [b, d]],
    [[a, d], [b, c]],
  ];
}
