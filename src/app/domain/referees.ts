import { Match, Tournament } from '../core/models';

/**
 * Auto-arbitrage : attribue un arbitre à chaque match programmé dont les deux équipes sont
 * connues et qui n'en a pas encore.
 *
 * Règles :
 *   • l'arbitre ne joue pas et n'arbitre pas déjà sur le même créneau ;
 *   • on choisit l'équipe qui a le moins arbitré jusque-là (sur tout le tournoi), pour que
 *     chacune arbitre à peu près le même nombre de matchs ;
 *   • à égalité, une équipe de la même poule (déjà sur place), puis l'ordre d'inscription.
 *
 * Les arbitres déjà attribués ne changent jamais : la fonction peut être rappelée après chaque
 * modification (nouvelle phase, qualifiés connus en phase finale) sans rien bouleverser.
 */
export function assignReferees(t: Tournament): Tournament {
  if (!t.settings.selfRefereeing) return t;

  const counts = new Map(t.teams.map((team) => [team.id, 0]));
  for (const m of t.matches) {
    if (m.referee) counts.set(m.referee, (counts.get(m.referee) ?? 0) + 1);
  }

  // Équipes occupées (qui jouent ou arbitrent) sur chaque créneau.
  const busy = new Map<number, Set<string>>();
  const occupy = (slot: number, teamId: string | null | undefined) => {
    if (!teamId) return;
    if (!busy.has(slot)) busy.set(slot, new Set());
    busy.get(slot)!.add(teamId);
  };
  for (const m of t.matches) {
    if (m.slot < 0 || m.bye) continue;
    occupy(m.slot, m.a.teamId);
    occupy(m.slot, m.b.teamId);
    occupy(m.slot, m.referee);
  }

  // Un créneau où un match de tableau attend encore ses équipes pourra accueillir n'importe
  // quelle équipe encore en lice : on ne la choisit pas comme arbitre sur ce créneau.
  const pendingSlots = new Set(t.matches.filter((m) => isPending(m)).map((m) => m.slot));
  const stillPlaying = new Set(
    t.matches
      .filter((m) => m.phase === 'bracket' && m.status !== 'done' && !m.bye)
      .flatMap((m) => [m.a.teamId, m.b.teamId])
      .filter((id): id is string => !!id),
  );

  const order = t.teams.map((team) => team.id);
  const sameStagePool = (m: Match, teamId: string) =>
    !!m.pool && !!t.pools.find((p) => p.letter === m.pool && p.stage === m.stage)?.teamIds.includes(teamId);

  let changed = false;
  const matches = [...t.matches];
  const indices = matches
    .map((m, i) => ({ m, i }))
    .sort((x, y) => x.m.slot - y.m.slot || x.m.court - y.m.court)
    .map(({ i }) => i);

  for (const i of indices) {
    const m = matches[i];
    if (m.referee || m.bye || m.status === 'done' || m.slot < 0 || !m.a.teamId || !m.b.teamId) continue;
    const taken = busy.get(m.slot) ?? new Set<string>();
    const candidates = order.filter(
      (id) => !taken.has(id) && !(pendingSlots.has(m.slot) && stillPlaying.has(id)),
    );
    if (!candidates.length) continue;
    const referee = candidates.reduce((best, id) => {
      const byCount = counts.get(id)! - counts.get(best)!;
      if (byCount !== 0) return byCount < 0 ? id : best;
      const byPool = Number(sameStagePool(m, best)) - Number(sameStagePool(m, id));
      return byPool > 0 ? id : best;
    });
    matches[i] = { ...m, referee };
    counts.set(referee, counts.get(referee)! + 1);
    occupy(m.slot, referee);
    changed = true;
  }
  return changed ? { ...t, matches } : t;
}

/** Match de tableau programmé dont au moins une équipe n'est pas encore connue. */
function isPending(m: Match): boolean {
  return m.phase === 'bracket' && !m.bye && m.slot >= 0 && (!m.a.teamId || !m.b.teamId);
}

/** Nombre de matchs arbitrés par équipe (pour vérifier l'équilibre). */
export function refereeCounts(t: Tournament): Map<string, number> {
  const counts = new Map(t.teams.map((team) => [team.id, 0]));
  for (const m of t.matches) {
    if (m.referee) counts.set(m.referee, (counts.get(m.referee) ?? 0) + 1);
  }
  return counts;
}
