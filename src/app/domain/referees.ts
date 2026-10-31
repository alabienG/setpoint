import { Match, Tournament } from '../core/models';
import { matchTeams } from './scoring';

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
    matchTeams(m).forEach((teamId) => occupy(m.slot, teamId));
    occupy(m.slot, m.referee);
  }

  // Un créneau où un match de tableau attend encore ses équipes pourra accueillir n'importe
  // quelle équipe encore en lice : on ne la choisit pas comme arbitre sur ce créneau.
  const pendingSlots = new Set(t.matches.filter((m) => isPending(m)).map((m) => m.slot));
  const stillPlaying = new Set(
    t.matches
      .filter((m) => m.phase === 'bracket' && m.status !== 'done' && !m.bye)
      .flatMap((m) => matchTeams(m)),
  );

  const order = t.teams.map((team) => team.id);
  const sameStagePool = (m: Match, teamId: string) =>
    !!m.pool && !!t.pools.find((p) => p.letter === m.pool && p.stage === m.stage)?.teamIds.includes(teamId);

  // « Laissée de côté » : nombre de créneaux arbitrés où l'équipe était libre sans être choisie.
  // À nombre d'arbitrages égal, on privilégie celle qui a déjà été laissée de côté le plus souvent,
  // sinon les mêmes équipes (les dernières inscrites) seraient toujours épargnées.
  const skipped = new Map(order.map((id) => [id, 0]));
  const markSkipped = (slot: number) => {
    const taken = busy.get(slot) ?? new Set<string>();
    order.filter((id) => !taken.has(id)).forEach((id) => skipped.set(id, skipped.get(id)! + 1));
  };
  for (const slot of new Set(t.matches.filter((m) => m.referee).map((m) => m.slot))) markSkipped(slot);

  // Dernier départage : tirage au sort reproductible (lié au tirage du tournoi). L'ordre
  // d'inscription, qui suit souvent le niveau, ferait toujours épargner les mêmes équipes.
  const lot = (teamId: string, slot: number) => hash(`${t.drawSeed}:${slot}:${teamId}`);

  let changed = false;
  const matches = [...t.matches];
  const indices = matches
    .map((m, i) => ({ m, i }))
    .sort((x, y) => x.m.slot - y.m.slot || x.m.court - y.m.court)
    .map(({ i }) => i);

  let currentSlot: number | null = null;
  for (const i of indices) {
    const m = matches[i];
    if (m.referee || m.bye || m.status === 'done' || m.slot < 0 || !m.a.teamId || !m.b.teamId) continue;
    // Créneau précédent pourvu : ses équipes restées libres ont été laissées de côté.
    if (currentSlot !== null && currentSlot !== m.slot) markSkipped(currentSlot);
    currentSlot = m.slot;
    const taken = busy.get(m.slot) ?? new Set<string>();
    const candidates = order.filter(
      (id) => !taken.has(id) && !(pendingSlots.has(m.slot) && stillPlaying.has(id)),
    );
    if (!candidates.length) continue;
    const referee = candidates.reduce((best, id) => {
      // Poules de 5 (15 paires) : la paire au repos arbitre le match de sa propre poule
      // (pas pour un barrage, où ce seraient toujours les mêmes paires de la poule).
      if (t.format === 'mixer' && m.kind !== 'tiebreak') {
        const byOwnPool = Number(sameStagePool(m, id)) - Number(sameStagePool(m, best));
        if (byOwnPool !== 0) return byOwnPool > 0 ? id : best;
      }
      const byCount = counts.get(id)! - counts.get(best)!;
      if (byCount !== 0) return byCount < 0 ? id : best;
      const bySkipped = skipped.get(id)! - skipped.get(best)!;
      if (bySkipped !== 0) return bySkipped > 0 ? id : best;
      const byPool = Number(sameStagePool(m, best)) - Number(sameStagePool(m, id));
      if (byPool !== 0) return byPool > 0 ? id : best;
      return lot(id, m.slot) < lot(best, m.slot) ? id : best;
    });
    matches[i] = { ...m, referee };
    counts.set(referee, counts.get(referee)! + 1);
    occupy(m.slot, referee);
    changed = true;
  }
  return changed ? { ...t, matches } : t;
}

/** Hachage FNV-1a 32 bits, pour un tirage au sort stable. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
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
