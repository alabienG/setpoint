import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Match, Side, Tournament } from '../../../core/models';
import { evaluateMatch, playedSets, winnerSide } from '../../../domain/scoring';
import {
  RankingRow,
  currentStage,
  stageLevels,
  withLevelStarts,
  finalRanking,
  poolStandings,
  qualifierTags,
  stagePools,
} from '../../../domain/tournament-engine';
import { Icon } from '../../../shared/icon';
import { levelClass } from '../../../shared/match-display';
import { TeamAvatar } from '../../../shared/team-avatar';
import { TournamentContext } from '../tournament-context';

const PLURALS: Record<string, string> = {
  'Demi-finale': 'Demi-finales',
  'Quart de finale': 'Quarts de finale',
  'Huitième de finale': 'Huitièmes de finale',
};

/** « Demi-finale 1 » → « Demi-finales ». */
function roundTitle(label: string): string {
  const base = label.replace(/\s\d+$/, '');
  return PLURALS[base] ?? base;
}

@Component({
  selector: 'app-results-page',
  imports: [Icon, TeamAvatar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './results-page.html',
  styleUrl: './results-page.scss',
})
export class ResultsPage {
  protected readonly ctx = inject(TournamentContext);
  protected readonly shareMessage = signal('');

  protected readonly t = computed(() => this.ctx.tournament() as Tournament);
  protected readonly finished = computed(() => this.t().stage === 'finished');
  protected readonly ranking = computed(() => finalRanking(this.t()));
  /** Classement avec un intertitre au début de chaque niveau (poules brassées, à partir de la phase 2). */
  protected readonly rankingRows = computed(() => withLevelStarts(this.ranking()));
  protected readonly levelClass = levelClass;

  /** Podium dans l'ordre d'affichage : 2e, 1er, 3e. */
  protected readonly podium = computed(() => {
    const [first, second, third] = this.ranking();
    const steps: { row: RankingRow; place: number }[] = [];
    if (second) steps.push({ row: second, place: 2 });
    if (first) steps.push({ row: first, place: 1 });
    if (third) steps.push({ row: third, place: 3 });
    return steps;
  });

  private readonly tags = computed(() => qualifierTags(this.t()));

  /** « Poules brassées » : poules de la dernière phase générée, avec leur classement. */
  protected readonly mixerPools = computed(() => {
    const t = this.t();
    const stage = currentStage(t);
    const levels = stageLevels(t, stage);
    let offset = 0;
    return {
      stage,
      pools: stagePools(t, stage).map((p) => {
        const entry = {
          pool: p,
          level: levels.get(p.letter),
          offset,
          rows: poolStandings(t, p).map((row) => ({ ...row, name: this.ctx.teamName(row.teamId) })),
        };
        offset += p.teamIds.length;
        return entry;
      }),
    };
  });

  protected readonly rounds = computed(() => {
    const bracket = this.t().matches.filter((m) => m.phase === 'bracket' && m.kind !== 'third');
    const byRound = new Map<number, Match[]>();
    bracket.forEach((m) => byRound.set(m.round, [...(byRound.get(m.round) ?? []), m]));
    return [...byRound.entries()]
      .sort(([x], [y]) => x - y)
      .map(([round, matches]) => ({
        round,
        title: roundTitle(matches[0].label),
        matches: matches.map((m) => this.view(m)),
      }));
  });

  protected readonly third = computed(() => {
    const m = this.t().matches.find((x) => x.kind === 'third');
    return m && !m.bye ? this.view(m) : null;
  });

  protected print(): void {
    window.print();
  }

  protected async share(): Promise<void> {
    const url = location.href;
    const title = `Résultats — ${this.t().name}`;
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      this.shareMessage.set('Lien copié dans le presse-papiers.');
    } catch {
      this.shareMessage.set('Impossible de partager le lien depuis ce navigateur.');
    }
  }

  private view(m: Match) {
    const settings = this.t().settings;
    const result = evaluateMatch(m, settings);
    const won = m.status === 'done' ? winnerSide(m, settings) : null;
    const row = (side: Side) => ({
      name: this.ctx.slotName(m, side),
      tag: m[side].teamId ? this.tags().get(m[side].teamId!) : undefined,
      sets: m.bye ? '' : side === 'a' ? result.setsA : result.setsB,
      win: won === side,
    });
    return {
      id: m.id,
      final: m.kind === 'final',
      bye: !!m.bye,
      done: m.status === 'done',
      rows: [row('a'), row('b')],
      detail: playedSets(m).map((s) => `${s[0]}-${s[1]}`).join(' · '),
    };
  }
}
