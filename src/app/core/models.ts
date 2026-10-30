export type FormatId = 'pools' | 'mixer' | 'elim' | 'double' | 'league' | 'swiss' | 'melee';
export type Level = 'Loisir' | 'Intermédiaire' | 'Avancé';
export type DrawMode = 'random' | 'seeds' | 'level';
export type MatchStatus = 'todo' | 'live' | 'done';
export type MatchPhase = 'pool' | 'league' | 'bracket';
export type TournamentStage = 'setup' | 'running' | 'finished';
export type Side = 'a' | 'b';

export const LEVELS: readonly Level[] = ['Loisir', 'Intermédiaire', 'Avancé'];

export interface Player {
  name: string;
  /** Catégorie ou équipe habituelle du joueur (« Mixte Mouv », « Departementale »…). */
  category: string;
}

export interface Team {
  id: string;
  name: string;
  level: Level;
  seed: boolean;
  /** Index dans la palette d'avatars. */
  color: number;
  players?: Player[];
  /** Niveau chiffré de 1 (débutant) à 5 (confirmé), utilisé pour les tirages par niveau. */
  rating?: number;
}

/** Règles d'un match : nombre de sets, points, plafond éventuel. */
export interface MatchRules {
  /** Nombre de sets à gagner : 1 (set unique), 2 (Bo3) ou 3 (Bo5). */
  setsToWin: 1 | 2 | 3;
  pointsPerSet: number;
  decidingSetPoints: number;
  /** Score maximal d'un set : à ce score, le set est gagné même avec 1 point d'écart. */
  cap: number | null;
}

/** Règles d'une phase du format « Poules brassées ». */
export interface PhaseRules extends MatchRules {
  minutes: number;
}

export interface TournamentSettings extends MatchRules {
  courts: number;
  maxTeams: number;
  poolCount: number;
  qualifiersPerPool: number;
  /** Heure du premier créneau, format HH:mm. */
  startTime: string;
  slotMinutes: number;
  /** Règles des phases 1 à 3 du format « Poules brassées ». */
  phases: PhaseRules[];
}

export type SetScore = [number | null, number | null];

export interface MatchSlot {
  teamId: string | null;
  /** Dans un tableau final : l'équipe vient du vainqueur ou du perdant d'un autre match. */
  from?: { matchId: string; take: 'winner' | 'loser' };
}

export interface Match {
  id: string;
  phase: MatchPhase;
  /** Identifiant de poule (phase de poules uniquement). */
  pool?: string;
  /** Numéro de phase (format « Poules brassées »). */
  stage?: number;
  /** Heure de début en minutes depuis minuit, quand elle ne se déduit pas du créneau. */
  start?: number;
  round: number;
  label: string;
  kind?: 'final' | 'third';
  a: MatchSlot;
  b: MatchSlot;
  /** Créneau horaire (0 = premier créneau), -1 si non programmé. */
  slot: number;
  court: number;
  sets: SetScore[];
  status: MatchStatus;
  /** Équipe exemptée : qualifiée sans jouer. */
  bye?: boolean;
  /** Set en cours de saisie sur la vue mobile. */
  liveSet?: number;
}

export interface Pool {
  letter: string;
  teamIds: string[];
  stage?: number;
  /** Rôle de la poule (« Principale », « Places 1-4 »…). */
  name?: string;
}

export interface Tournament {
  id: string;
  name: string;
  createdAt: string;
  date: string | null;
  format: FormatId;
  settings: TournamentSettings;
  teams: Team[];
  drawMode: DrawMode;
  drawSeed: number;
  drawRound: number;
  pools: Pool[];
  matches: Match[];
  stage: TournamentStage;
  /** Adresse publique (/:slug), attribuée par le serveur. */
  slug?: string;
  /** Version serveur, pour détecter les modifications concurrentes. */
  version?: number;
}

export const DEFAULT_PHASES: PhaseRules[] = [
  { setsToWin: 1, pointsPerSet: 19, decidingSetPoints: 19, cap: 21, minutes: 20 },
  { setsToWin: 1, pointsPerSet: 25, decidingSetPoints: 25, cap: 27, minutes: 25 },
  { setsToWin: 1, pointsPerSet: 25, decidingSetPoints: 25, cap: null, minutes: 30 },
];

export const DEFAULT_SETTINGS: TournamentSettings = {
  setsToWin: 2,
  pointsPerSet: 25,
  decidingSetPoints: 15,
  cap: null,
  phases: DEFAULT_PHASES,
  courts: 2,
  maxTeams: 8,
  poolCount: 2,
  qualifiersPerPool: 2,
  startTime: '09:00',
  slotMinutes: 45,
};
