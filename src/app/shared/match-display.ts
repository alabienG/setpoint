import { Match } from '../core/models';

function poolIndex(id: string): number {
  return /^\d+$/.test(id) ? Number(id) - 1 : id.charCodeAt(0) - 65;
}

/** Classe de l'étiquette d'un match : une couleur par poule, une pour le tableau final. */
export function matchTagClass(match: Match): string {
  if (match.phase === 'bracket') return 'tag tag--bracket';
  if (match.phase === 'pool' && match.pool) return `tag ${poolTagClass(match.pool)}`;
  return 'tag tag--0';
}

export function poolTagClass(id: string): string {
  return `tag--${poolIndex(id) % 4}`;
}

/** Libellé court d'un match : « Poule A », « P2 · Poule 3 », « Demi-finale 1 »… */
export function matchTag(match: Match): string {
  if (match.phase !== 'pool') return match.label;
  if (match.kind === 'tiebreak') return `P${match.stage} · Barrage poule ${match.pool}`;
  return match.stage ? `P${match.stage} · Poule ${match.pool}` : `Poule ${match.pool}`;
}

/** Pastille d'un niveau de poules brassées (0 = Principale / Places 1 à 4…). */
export function levelClass(rank: number): string {
  return `level level--${Math.min(rank, 3)}`;
}
