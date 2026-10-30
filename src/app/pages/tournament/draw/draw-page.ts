import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { DrawMode, Match, Tournament } from '../../../core/models';
import { matchTime, teamRating } from '../../../domain/draw';
import { DrawResult, drawBlockers, generateDraw } from '../../../domain/tournament-engine';
import { assignReferees } from '../../../domain/referees';
import { Icon } from '../../../shared/icon';
import { matchTagClass, poolTagClass } from '../../../shared/match-display';
import { TournamentContext } from '../tournament-context';

@Component({
  selector: 'app-draw-page',
  imports: [RouterLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './draw-page.html',
  styleUrl: './draw-page.scss',
})
export class DrawPage {
  protected readonly ctx = inject(TournamentContext);
  private readonly router = inject(Router);
  protected readonly tagClass = matchTagClass;
  protected readonly poolTagClass = poolTagClass;

  protected readonly t = computed(() => this.ctx.tournament() as Tournament);
  protected readonly modes = computed<{ id: DrawMode; label: string }[]>(() =>
    this.t().format === 'mixer'
      ? [
          { id: 'level', label: 'Par niveau (homogène)' },
          { id: 'random', label: 'Aléatoire' },
        ]
      : [
          { id: 'random', label: 'Aléatoire' },
          { id: 'seeds', label: 'Têtes de série' },
          { id: 'level', label: 'Par niveau' },
        ],
  );
  /** Poules affichées : celles de la phase 1 en « Poules brassées ». */
  protected readonly pools = computed(() => (this.draw()?.pools ?? []).filter((p) => (p.stage ?? 1) === 1));
  protected readonly averageRating = (teamIds: string[]) => {
    const values = teamIds.map((id) => teamRating(this.ctx.teamsById().get(id)!));
    return (values.reduce((a, b) => a + b, 0) / Math.max(1, values.length)).toFixed(1).replace('.', ',');
  };
  protected readonly locked = this.ctx.locked;
  protected readonly blockers = computed(() => (this.locked() ? [] : drawBlockers(this.t())));

  protected readonly draw = computed<DrawResult | null>(() => {
    const t = this.t();
    if (this.locked()) {
      return {
        pools: t.pools,
        matches: t.matches.filter((m) => (m.phase !== 'bracket' || t.format === 'elim') && (m.stage ?? 1) === 1),
      };
    }
    if (this.blockers().length) return null;
    // Aperçu avec les arbitres, tels qu'ils seront attribués à la validation.
    const preview = assignReferees({ ...t, ...generateDraw(t) });
    return { pools: preview.pools, matches: preview.matches };
  });

  protected readonly slots = computed(() => {
    const draw = this.draw();
    if (!draw) return [];
    const bySlot = new Map<number, Match[]>();
    for (const m of draw.matches.filter((x) => !x.bye)) {
      bySlot.set(m.slot, [...(bySlot.get(m.slot) ?? []), m]);
    }
    return [...bySlot.entries()]
      .sort(([x], [y]) => x - y)
      .map(([slot, games]) => ({ slot, time: matchTime(games[0], this.t().settings), games: games.sort((x, y) => x.court - y.court) }));
  });

  protected readonly firstRound = computed(() => this.draw()?.matches.filter((m) => m.phase === 'bracket' && m.round === 1) ?? []);
  protected readonly leagueRounds = computed(() => Math.max(0, ...(this.draw()?.matches.map((m) => m.round) ?? [])));

  protected setMode(mode: DrawMode): void {
    this.ctx.store.setDrawMode(this.t().id, mode);
  }

  protected redraw(): void {
    this.ctx.store.redraw(this.t().id);
  }

  protected async validate(): Promise<void> {
    this.ctx.store.validateDraw(this.t().id);
    await this.router.navigate(['/organisateur', this.t().id, 'matchs']);
  }

  protected name(m: Match, side: 'a' | 'b'): string {
    return this.ctx.slotName(m, side, this.draw()?.matches);
  }
}
