import { FormatId, TournamentSettings } from '../core/models';
import { bracketSize } from './bracket';

export interface FormatInfo {
  id: FormatId;
  name: string;
  description: string;
  /** Formats dont le tirage et le déroulé sont implémentés. */
  available: boolean;
  recommended?: boolean;
}

export const FORMATS: readonly FormatInfo[] = [
  {
    id: 'pools',
    name: 'Poules + phase finale',
    description: 'Matchs en poules, puis les meilleures équipes s’affrontent dans un tableau final.',
    available: true,
    recommended: true,
  },
  {
    id: 'mixer',
    name: 'Poules brassées',
    description:
      'Paires en 4 contre 4, poules de 4 paires sur trois phases : niveau homogène, puis brassage principale / consolante jusqu’au classement complet.',
    available: true,
  },
  {
    id: 'elim',
    name: 'Élimination directe',
    description: 'Chaque défaite élimine. Le format le plus rapide et le plus intense.',
    available: true,
  },
  {
    id: 'double',
    name: 'Double élimination',
    description: 'Une seconde chance grâce au tableau des perdants.',
    available: false,
  },
  {
    id: 'league',
    name: 'Championnat',
    description: 'Tous contre tous, classement aux points. Le plus équitable.',
    available: true,
  },
  {
    id: 'swiss',
    name: 'Système suisse',
    description: 'Rondes successives entre équipes de même bilan, sans élimination.',
    available: false,
  },
  {
    id: 'melee',
    name: 'Mêlée',
    description: 'Inscriptions individuelles, équipes recomposées à chaque rotation.',
    available: false,
  },
];

/**
 * Le format « Poules brassées » se joue en 4 contre 4 : deux paires contre deux paires.
 *   • 12 paires : 3 poules de 4 ; 16 paires : 4 poules de 4 (3 matchs par poule, tout le monde joue) ;
 *   • 15 paires : 3 poules de 5 (5 matchs par poule, une paire au repos à chaque match).
 */
export const MIXER_SIZES: readonly number[] = [12, 15, 16];
export const MIXER_DEFAULT_TEAMS = 16;
export const MIXER_PHASES = 3;

/** Taille des poules : 5 paires à 15, sinon 4. */
export function mixerPoolSize(teams: number): number {
  return teams === 15 ? 5 : 4;
}

/** Matchs d'une poule : 3 pour 4 paires, 5 pour 5 paires. */
export function mixerPoolMatches(poolSize: number): number {
  return poolSize === 5 ? 5 : 3;
}

/** Matchs d'une phase. */
export function mixerMatchesPerStage(teams: number): number {
  const size = mixerPoolSize(teams);
  return (teams / size) * mixerPoolMatches(size);
}

export function formatName(id: FormatId): string {
  return FORMATS.find((f) => f.id === id)?.name ?? id;
}

function roundRobinCount(n: number): number {
  return (n * (n - 1)) / 2;
}

function eliminationCount(n: number): number {
  if (n < 2) return 0;
  return n - 1 + (bracketSize(n) >= 4 ? 1 : 0);
}

/** Nombre de matchs attendu pour un format, à titre indicatif sur l'écran de choix. */
export function estimateMatches(format: FormatId, settings: TournamentSettings): string {
  const n = settings.maxTeams;
  switch (format) {
    case 'pools': {
      const pools = Math.max(1, settings.poolCount);
      const base = Math.floor(n / pools);
      const extra = n % pools;
      let total = 0;
      for (let i = 0; i < pools; i++) total += roundRobinCount(base + (i < extra ? 1 : 0));
      total += eliminationCount(pools * settings.qualifiersPerPool);
      return `${total} matchs pour ${n} équipes`;
    }
    case 'mixer': {
      const teams = MIXER_SIZES.includes(n) ? n : MIXER_DEFAULT_TEAMS;
      return `${mixerMatchesPerStage(teams) * MIXER_PHASES} matchs en 4 contre 4 pour ${teams} paires`;
    }
    case 'elim':
      return `${eliminationCount(n)} matchs pour ${n} équipes`;
    case 'double':
      return `${2 * n - 2} à ${2 * n - 1} matchs pour ${n} équipes`;
    case 'league':
      return `${roundRobinCount(n)} matchs pour ${n} équipes`;
    case 'swiss': {
      const rounds = Math.ceil(Math.log2(Math.max(2, n)));
      return `${rounds * Math.floor(n / 2)} matchs en ${rounds} rondes`;
    }
    case 'melee':
      return 'Classement individuel';
  }
}
