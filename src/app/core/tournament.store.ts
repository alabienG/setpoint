import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import {
  canGenerateFinals,
  canGenerateNextStage,
  generateDraw,
  generateFinals,
  generateNextStage,
  matchRules,
  normalize,
} from '../domain/tournament-engine';
import { MIXER_MAX_TEAMS } from '../domain/formats';
import { newId, randomSeed } from '../domain/random';
import { evaluateMatch, maxSets } from '../domain/scoring';
import { ImportedTeam } from '../domain/team-import';
import {
  DEFAULT_SETTINGS,
  DrawMode,
  FormatId,
  Level,
  Match,
  SetScore,
  Side,
  Tournament,
  TournamentSettings,
} from './models';
import { ConflictError, TournamentRepository } from './storage/tournament-repository';

const AVATAR_COLORS = 8;

type Change = (t: Tournament) => Tournament;

/** Nombre de conflits successifs au-delà duquel on abandonne l'enregistrement. */
const MAX_CONFLICT_RETRIES = 5;
const RETRY_DELAY_MS = 5000;

/**
 * Source de vérité de l'application : état en signaux, persistance déléguée au repository.
 *
 * Chaque modification est appliquée immédiatement à l'écran, puis enregistrée en arrière-plan.
 * Si un autre appareil a modifié la compétition entre-temps (conflit de version), le store
 * recharge la dernière version et y rejoue les modifications en attente.
 */
@Injectable()
export class TournamentStore {
  private readonly repository = inject(TournamentRepository);
  private readonly state = signal<Tournament[]>([]);
  private readonly loadedState = signal(false);
  private readonly saveErrorState = signal<string | null>(null);
  /** Modifications appliquées localement mais pas encore enregistrées, par compétition. */
  private readonly pending = new Map<string, Change[]>();
  private readonly saving = new Set<string>();

  readonly tournaments = computed(() =>
    [...this.state()].sort((x, y) => y.createdAt.localeCompare(x.createdAt)),
  );
  readonly loaded = this.loadedState.asReadonly();
  /** Message à afficher quand l'enregistrement échoue (réseau, serveur). */
  readonly saveError = this.saveErrorState.asReadonly();
  readonly ready: Promise<void>;

  constructor() {
    this.ready = this.reload();
    const unwatch = this.repository.watch(() => void this.reload());
    inject(DestroyRef).onDestroy(unwatch);
  }

  get(id: string): Tournament | undefined {
    return this.state().find((t) => t.id === id);
  }

  async create(name = 'Nouveau tournoi'): Promise<Tournament> {
    await this.ready;
    const draft: Tournament = {
      id: newId(),
      name,
      createdAt: new Date().toISOString(),
      date: null,
      format: 'pools',
      settings: { ...DEFAULT_SETTINGS },
      teams: [],
      drawMode: 'seeds',
      drawSeed: randomSeed(),
      drawRound: 1,
      pools: [],
      matches: [],
      stage: 'setup',
    };
    // Le serveur attribue l'identifiant définitif et l'adresse publique.
    const tournament = await this.repository.create(draft);
    this.state.update((all) => [...all, tournament]);
    return tournament;
  }

  async remove(id: string): Promise<void> {
    await this.repository.delete(id);
    this.pending.delete(id);
    this.state.update((all) => all.filter((t) => t.id !== id));
  }

  // — Préparation —

  rename(id: string, name: string): void {
    this.update(id, (t) => ({ ...t, name: name.trim() || t.name }));
  }

  setDate(id: string, date: string | null): void {
    this.update(id, (t) => ({ ...t, date: date || null }));
  }

  setFormat(id: string, format: FormatId): void {
    this.updateSetup(id, (t) => {
      if (format !== 'mixer') return { ...t, format };
      // Modèle « Poules brassées » : jusqu'à 16 équipes, 3 terrains, poules de niveau homogène.
      const maxTeams = Math.max(MIXER_MAX_TEAMS, t.teams.length);
      return {
        ...t,
        format,
        drawMode: t.drawMode === 'seeds' ? 'level' : t.drawMode,
        settings: { ...t.settings, maxTeams, courts: 3 },
      };
    });
  }

  updatePhase(id: string, index: number, changes: Partial<TournamentSettings['phases'][number]>): void {
    this.updateSetup(id, (t) => ({
      ...t,
      settings: { ...t.settings, phases: t.settings.phases.map((p, i) => (i === index ? { ...p, ...changes } : p)) },
    }));
  }

  /** Auto-arbitrage : réglé avant le tirage, car il limite le nombre de matchs simultanés. */
  setSelfRefereeing(id: string, selfRefereeing: boolean): void {
    this.updateSetup(id, (t) => ({ ...t, settings: { ...t.settings, selfRefereeing } }));
  }

  setTeamRating(id: string, teamId: string, rating: number): void {
    this.updateSetup(id, (t) => ({
      ...t,
      teams: t.teams.map((team) => (team.id === teamId ? { ...team, rating } : team)),
    }));
  }

  updateSettings(id: string, changes: Partial<TournamentSettings>): void {
    this.updateSetup(id, (t) => ({ ...t, settings: { ...t.settings, ...changes } }));
  }

  addTeam(id: string, name: string, level: Level): void {
    this.updateSetup(id, (t) => {
      const clean = name.trim();
      if (!clean || t.teams.length >= t.settings.maxTeams) return t;
      return {
        ...t,
        teams: [...t.teams, { id: newId(), name: clean, level, seed: false, color: t.teams.length % AVATAR_COLORS }],
      };
    });
  }

  /** Ajoute plusieurs équipes dans la limite des places ; renvoie le nombre d'équipes ajoutées. */
  importTeams(id: string, rows: ImportedTeam[]): number {
    let added = 0;
    this.updateSetup(id, (t) => {
      const room = Math.max(0, t.settings.maxTeams - t.teams.length);
      const existing = new Set(t.teams.map((team) => team.name.toLowerCase()));
      const fresh = rows.filter((r) => r.name && !existing.has(r.name.toLowerCase())).slice(0, room);
      added = fresh.length;
      return {
        ...t,
        teams: [
          ...t.teams,
          ...fresh.map((r, i) => ({
            id: newId(),
            name: r.name,
            level: r.level,
            seed: false,
            color: (t.teams.length + i) % AVATAR_COLORS,
            ...(r.players ? { players: r.players } : {}),
            ...(r.rating !== undefined ? { rating: r.rating } : {}),
          })),
        ],
      };
    });
    return added;
  }

  removeTeam(id: string, teamId: string): void {
    this.updateSetup(id, (t) => ({ ...t, teams: t.teams.filter((team) => team.id !== teamId) }));
  }

  toggleSeed(id: string, teamId: string): void {
    this.updateSetup(id, (t) => ({
      ...t,
      teams: t.teams.map((team) => (team.id === teamId ? { ...team, seed: !team.seed } : team)),
    }));
  }

  // — Tirage —

  setDrawMode(id: string, drawMode: DrawMode): void {
    this.updateSetup(id, (t) => ({ ...t, drawMode }));
  }

  redraw(id: string): void {
    this.updateSetup(id, (t) => ({ ...t, drawSeed: randomSeed(), drawRound: t.drawRound + 1 }));
  }

  validateDraw(id: string): void {
    this.updateSetup(id, (t) => ({ ...t, ...generateDraw(t), stage: 'running' }));
  }

  // — Matchs —

  setScore(id: string, matchId: string, setIndex: number, side: Side, value: number | null): void {
    this.updateMatch(id, matchId, (m) => {
      const sets = m.sets.map((score, i): SetScore => {
        if (i !== setIndex) return score;
        return side === 'a' ? [value, score[1]] : [score[0], value];
      });
      return { ...m, sets };
    });
  }

  /** Ajoute (ou retire) un point dans un set : utilisé par la saisie en direct. */
  addPoint(id: string, matchId: string, setIndex: number, side: Side, delta: 1 | -1): void {
    this.updateMatch(id, matchId, (m) => {
      const sets = m.sets.map((score, i): SetScore => {
        if (i !== setIndex) return score;
        const a = score[0] ?? 0;
        const b = score[1] ?? 0;
        return side === 'a' ? [Math.max(0, a + delta), b] : [a, Math.max(0, b + delta)];
      });
      return { ...m, sets, liveSet: setIndex };
    });
  }

  setLiveSet(id: string, matchId: string, setIndex: number): void {
    this.updateMatch(id, matchId, (m) => ({ ...m, liveSet: setIndex }));
  }

  validateMatch(id: string, matchId: string): void {
    this.update(id, (t) => {
      const match = t.matches.find((m) => m.id === matchId);
      if (!match || match.status === 'done' || !evaluateMatch(match, matchRules(t, match)).winner) return t;
      return { ...t, matches: t.matches.map((m) => (m.id === matchId ? { ...m, status: 'done', liveSet: undefined } : m)) };
    });
  }

  /** Génère la phase suivante : tableau final (poules + phase finale) ou nouvelle phase (poules brassées). */
  advance(id: string): void {
    this.update(id, (t) => {
      if (canGenerateFinals(t)) return { ...t, matches: [...t.matches, ...generateFinals(t)] };
      if (canGenerateNextStage(t)) {
        const next = generateNextStage(t);
        return { ...t, pools: [...t.pools, ...next.pools], matches: [...t.matches, ...next.matches] };
      }
      return t;
    });
  }

  // — Démo —

  async createDemo(): Promise<Tournament> {
    const t = await this.create('Tournoi d’automne');
    this.importTeams(t.id, [
      { name: 'Les Smashers', level: 'Avancé' },
      { name: 'Côté Filet', level: 'Intermédiaire' },
      { name: 'Ace Lyon', level: 'Avancé' },
      { name: 'Net Ninjas', level: 'Intermédiaire' },
      { name: 'Block Party', level: 'Avancé' },
      { name: 'Les Libéros', level: 'Loisir' },
      { name: 'Sideout', level: 'Intermédiaire' },
      { name: 'Les Passeurs', level: 'Loisir' },
    ]);
    const seeded = this.get(t.id)!.teams.filter((team) => ['Les Smashers', 'Ace Lyon'].includes(team.name));
    seeded.forEach((team) => this.toggleSeed(t.id, team.id));
    this.validateDraw(t.id);

    const scores: SetScore[][] = [
      [[25, 21], [25, 23]],
      [[25, 18], [25, 20]],
      [[23, 25], [25, 21], [15, 12]],
      [[25, 16], [22, 25], [15, 13]],
      [[25, 14], [25, 17]],
      [[25, 21], [25, 19]],
    ];
    const ordered = [...this.get(t.id)!.matches].sort((x, y) => x.slot - y.slot || x.court - y.court);
    scores.forEach((sets, i) => {
      sets.forEach(([a, b], s) => {
        this.setScore(t.id, ordered[i].id, s, 'a', a);
        this.setScore(t.id, ordered[i].id, s, 'b', b);
      });
      this.validateMatch(t.id, ordered[i].id);
    });
    const live = ordered[scores.length];
    this.setScore(t.id, live.id, 0, 'a', 25);
    this.setScore(t.id, live.id, 0, 'b', 21);
    this.setScore(t.id, live.id, 1, 'a', 18);
    this.setScore(t.id, live.id, 1, 'b', 20);
    this.setLiveSet(t.id, live.id, 1);
    return this.get(t.id)!;
  }

  // — Interne —

  /** Recharge depuis le serveur, sans écraser une compétition dont des modifications sont en cours d'envoi. */
  private async reload(): Promise<void> {
    const all = (await this.repository.loadAll()).map(withDefaults);
    this.state.update((current) =>
      all.map((t) => (this.isBusy(t.id) ? (current.find((c) => c.id === t.id) ?? t) : t)),
    );
    this.loadedState.set(true);
  }

  private isBusy(id: string): boolean {
    return this.saving.has(id) || (this.pending.get(id)?.length ?? 0) > 0;
  }

  private update(id: string, change: Change): void {
    const current = this.get(id);
    if (!current) return;
    const changed = change(current);
    if (changed === current) return;
    this.replace(normalize(changed));
    this.pending.set(id, [...(this.pending.get(id) ?? []), change]);
    void this.flush(id);
  }

  private replace(tournament: Tournament): void {
    this.state.update((all) => all.map((t) => (t.id === tournament.id ? tournament : t)));
  }

  /**
   * Envoie l'état courant de la compétition, une requête à la fois.
   * En cas de conflit, rejoue les modifications en attente sur la version du serveur.
   */
  private async flush(id: string): Promise<void> {
    if (this.saving.has(id)) return;
    this.saving.add(id);
    let conflicts = 0;
    try {
      while ((this.pending.get(id)?.length ?? 0) > 0) {
        const batch = this.pending.get(id)!;
        this.pending.set(id, []);
        const local = this.get(id);
        if (!local) return;
        try {
          const saved = await this.repository.save(local);
          // Les modifications faites pendant l'envoi restent à l'écran : seule la version change.
          const latest = this.get(id);
          if (latest) this.replace({ ...latest, version: saved.version });
          this.saveErrorState.set(null);
          conflicts = 0;
        } catch (error) {
          const queued = [...batch, ...(this.pending.get(id) ?? [])];
          this.pending.set(id, queued);
          if (!(error instanceof ConflictError)) {
            this.saveErrorState.set('Enregistrement impossible pour le moment, nouvel essai dans quelques secondes…');
            setTimeout(() => void this.flush(id), RETRY_DELAY_MS);
            return;
          }
          if (++conflicts > MAX_CONFLICT_RETRIES) {
            this.saveErrorState.set('La compétition est modifiée sur un autre appareil : rechargez la page.');
            return;
          }
          let server: Tournament;
          try {
            server = withDefaults(await this.repository.get(id));
          } catch {
            this.saveErrorState.set('Enregistrement impossible pour le moment, nouvel essai dans quelques secondes…');
            setTimeout(() => void this.flush(id), RETRY_DELAY_MS);
            return;
          }
          this.replace(queued.reduce((t, change) => normalize(change(t)), server));
        }
      }
    } finally {
      this.saving.delete(id);
    }
  }

  /** Les réglages, équipes et tirage ne bougent plus une fois le tournoi lancé. */
  private updateSetup(id: string, change: (t: Tournament) => Tournament): void {
    this.update(id, (t) => (t.stage === 'setup' ? change(t) : t));
  }

  private updateMatch(id: string, matchId: string, change: (m: Match) => Match): void {
    this.update(id, (t) => {
      const match = t.matches.find((m) => m.id === matchId);
      if (!match || match.status === 'done' || !match.a.teamId || !match.b.teamId) return t;
      let next = change(match);
      if (next.sets.length < maxSets(matchRules(t, match))) return t;
      if (next.status === 'todo') next = { ...next, status: 'live' };
      return { ...t, matches: t.matches.map((m) => (m.id === matchId ? next : m)) };
    });
  }
}

/** Les compétitions enregistrées avant l'ajout d'un réglage reçoivent sa valeur par défaut. */
function withDefaults(t: Tournament): Tournament {
  return { ...t, settings: { ...DEFAULT_SETTINGS, ...t.settings } };
}
