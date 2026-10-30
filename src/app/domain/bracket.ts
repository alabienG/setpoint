import { Match, MatchSlot, TournamentSettings } from '../core/models';
import { emptySets, otherSide, winnerSide } from './scoring';

/** Ordre de placement standard : la tête de série 1 ne peut croiser la 2 qu'en finale. */
export function seedOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((s) => [s, n + 1 - s]);
  }
  return order;
}

export function bracketSize(teamCount: number): number {
  return Math.max(2, 2 ** Math.ceil(Math.log2(Math.max(2, teamCount))));
}

export function roundName(teamsInRound: number): string {
  switch (teamsInRound) {
    case 2:
      return 'Finale';
    case 4:
      return 'Demi-finale';
    case 8:
      return 'Quart de finale';
    case 16:
      return 'Huitième de finale';
    default:
      return `Tour à ${teamsInRound}`;
  }
}

function bracketMatch(id: string, round: number, label: string, a: MatchSlot, b: MatchSlot, settings: TournamentSettings): Match {
  return { id, phase: 'bracket', round, label, a, b, slot: -1, court: 0, sets: emptySets(settings), status: 'todo' };
}

/**
 * Construit un tableau à élimination directe à partir d'équipes classées (meilleure en premier).
 * Les places vides deviennent des exemptions ; un match pour la 3e place est ajouté dès 4 places.
 */
export function buildBracket(seededIds: readonly string[], settings: TournamentSettings, idPrefix: string): Match[] {
  const size = bracketSize(seededIds.length);
  const order = seedOrder(size);
  const rounds = Math.log2(size);
  let counter = 0;
  const nextId = () => `${idPrefix}${++counter}`;
  const label = (teamsInRound: number, index: number, count: number) =>
    count > 1 ? `${roundName(teamsInRound)} ${index + 1}` : roundName(teamsInRound);

  const all: Match[] = [];
  let previous: Match[] = [];
  for (let round = 1; round <= rounds; round++) {
    const teamsInRound = size / 2 ** (round - 1);
    const count = teamsInRound / 2;
    const current: Match[] = [];
    for (let i = 0; i < count; i++) {
      let match: Match;
      if (round === 1) {
        const a = seededIds[order[2 * i] - 1] ?? null;
        const b = seededIds[order[2 * i + 1] - 1] ?? null;
        match = bracketMatch(nextId(), round, label(teamsInRound, i, count), { teamId: a }, { teamId: b }, settings);
        if (!a || !b) {
          match = { ...match, bye: true, status: 'done' };
        }
      } else {
        match = bracketMatch(
          nextId(),
          round,
          label(teamsInRound, i, count),
          { teamId: null, from: { matchId: previous[2 * i].id, take: 'winner' } },
          { teamId: null, from: { matchId: previous[2 * i + 1].id, take: 'winner' } },
          settings,
        );
      }
      if (round === rounds) match = { ...match, kind: 'final' };
      current.push(match);
    }
    if (round === rounds && size >= 4) {
      const [semi1, semi2] = previous;
      all.push({
        ...bracketMatch(
          nextId(),
          round,
          'Match pour la 3e place',
          { teamId: null, from: { matchId: semi1.id, take: 'loser' } },
          { teamId: null, from: { matchId: semi2.id, take: 'loser' } },
          settings,
        ),
        kind: 'third',
      });
    }
    all.push(...current);
    previous = current;
  }
  return all;
}

/** Fait avancer les équipes dans le tableau selon les matchs terminés. */
export function resolveBracket(matches: readonly Match[], settings: TournamentSettings): Match[] {
  const byId = new Map(matches.map((m) => [m.id, m]));

  const resolveSlot = (slot: MatchSlot): { slot: MatchSlot; pending: boolean } => {
    if (!slot.from) return { slot, pending: false };
    const source = byId.get(slot.from.matchId);
    if (!source || source.status !== 'done') return { slot: { ...slot, teamId: null }, pending: true };
    const won = winnerSide(source, settings);
    const side = won && (slot.from.take === 'winner' ? won : otherSide(won));
    return { slot: { ...slot, teamId: side ? source[side].teamId : null }, pending: false };
  };

  return matches.map((match) => {
    if (match.phase !== 'bracket' || match.status === 'done') return match;
    const a = resolveSlot(match.a);
    const b = resolveSlot(match.b);
    let updated: Match = { ...match, a: a.slot, b: b.slot };
    const ready = !a.pending && !b.pending;
    if (ready && (!updated.a.teamId || !updated.b.teamId)) {
      updated = { ...updated, bye: true, status: 'done' };
    }
    byId.set(updated.id, updated);
    return updated;
  });
}
