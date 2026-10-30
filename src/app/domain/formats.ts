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
      'Trois phases de poules de 4 : groupes de niveau homogène, puis brassage principale / consolante jusqu’au classement complet.',
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
 * Le format « Poules brassées » se joue en poules de 3 ou 4 :
 * 4 poules de 13 à 16 équipes, 3 poules de 9 à 12 équipes.
 */
export const MIXER_MIN_TEAMS = 9;
export const MIXER_MAX_TEAMS = 16;
export const MIXER_PHASES = 3;

export function mixerPoolCount(teams: number): number {
  return teams > 12 ? 4 : 3;
}

/** Tailles des poules, les poules de 4 d'abord (ex. 14 équipes → 4, 4, 3, 3). */
export function mixerPoolSizes(teams: number): number[] {
  const pools = mixerPoolCount(teams);
  const fours = Math.max(0, Math.min(pools, teams - 3 * pools));
  return Array.from({ length: pools }, (_, i) => (i < fours ? 4 : 3));
}

/** Matchs d'une phase : 6 par poule de 4, 3 par poule de 3. */
export function mixerMatchesPerStage(teams: number): number {
  return mixerPoolSizes(teams).reduce((sum, size) => sum + (size * (size - 1)) / 2, 0);
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
      const teams = Math.min(MIXER_MAX_TEAMS, Math.max(MIXER_MIN_TEAMS, n));
      return `${mixerMatchesPerStage(teams) * MIXER_PHASES} matchs en ${MIXER_PHASES} phases pour ${teams} équipes`;
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
