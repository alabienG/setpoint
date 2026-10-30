import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Match, MatchStatus, Side, Tournament } from '../../../core/models';
import { matchTime } from '../../../domain/draw';
import { describeRules, evaluateMatch, playedSets, setLabel, setWinner } from '../../../domain/scoring';
import {
  leagueStandings,
  matchRules,
  mixerStageNote,
  nextStep,
  poolStandings,
  progress,
  stagePools,
} from '../../../domain/tournament-engine';
import { Icon } from '../../../shared/icon';
import { matchTag, matchTagClass } from '../../../shared/match-display';
import { TournamentContext } from '../tournament-context';

type Filter = 'all' | MatchStatus;

const STATUS_LABELS: Record<MatchStatus, string> = { live: 'En direct', done: 'Terminé', todo: 'À venir' };

@Component({
  selector: 'app-matches-page',
  imports: [RouterLink, NgTemplateOutlet, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './matches-page.html',
  styleUrl: './matches-page.scss',
})
export class MatchesPage {
  protected readonly ctx = inject(TournamentContext);
  protected readonly tagClass = matchTagClass;
  protected readonly statusLabels: Record<string, string> = STATUS_LABELS;

  protected readonly filter = signal<Filter>('all');
  protected readonly filters: { id: Filter; label: string }[] = [
    { id: 'all', label: 'Tous' },
    { id: 'live', label: 'En direct' },
    { id: 'todo', label: 'À venir' },
    { id: 'done', label: 'Terminés' },
  ];
  private readonly selectedId = signal<string | null>(null);

  protected readonly t = computed(() => this.ctx.tournament() as Tournament);
  protected readonly progress = computed(() => progress(this.t()));
  protected readonly nextStep = computed(() => nextStep(this.t()));

  private readonly playable = computed(() =>
    this.t()
      .matches.filter((m) => !m.bye)
      .sort((x, y) => x.slot - y.slot || x.court - y.court),
  );

  protected readonly cards = computed(() => {
    const t = this.t();
    const selected = this.selected()?.id;
    return this.playable()
      .filter((m) => this.filter() === 'all' || m.status === this.filter())
      .map((m) => {
        const rules = matchRules(t, m);
        const result = evaluateMatch(m, rules);
        const started = m.status !== 'todo';
        // En set unique, on affiche directement les points plutôt que les sets gagnés.
        const single = rules.setsToWin === 1;
        return {
          m,
          selected: m.id === selected,
          time: matchTime(m, t.settings),
          tag: matchTag(m),
          a: this.ctx.slotName(m, 'a'),
          b: this.ctx.slotName(m, 'b'),
          setsA: started ? (single ? result.pointsA : result.setsA) : '–',
          setsB: started ? (single ? result.pointsB : result.setsB) : '–',
          winner: m.status === 'done' ? result.winner : null,
          detail: playedSets(m).map((s) => `${s[0]}-${s[1]}`).join('  ·  ') || 'Pas encore commencé',
        };
      });
  });

  /**
   * Matchs regroupés par phase (phases 1 à 3, ou poules puis phase finale).
   * Seule la phase en cours est dépliée par défaut ; l'organisateur peut ouvrir ou fermer les autres.
   */
  protected readonly groups = computed(() => {
    const t = this.t();
    const groupOf = (m: Match) =>
      m.stage ? { key: `s${m.stage}`, title: `Phase ${m.stage}` } : m.phase === 'bracket' ? { key: 'bracket', title: 'Phase finale' } : { key: m.phase, title: t.format === 'league' ? 'Championnat' : 'Phase de poules' };
    const cards = this.cards();
    const groups: { key: string; title: string; total: number; done: number; cards: typeof cards }[] = [];
    for (const m of this.playable()) {
      const { key, title } = groupOf(m);
      let group = groups.find((g) => g.key === key);
      if (!group) groups.push((group = { key, title, total: 0, done: 0, cards: [] }));
      group.total++;
      if (m.status === 'done') group.done++;
    }
    for (const card of cards) {
      groups.find((g) => g.key === groupOf(card.m).key)!.cards.push(card);
    }
    const current = groups.at(-1)?.key;
    return groups.map((g) => ({ ...g, open: this.expanded()[g.key] ?? g.key === current }));
  });
  private readonly expanded = signal<Record<string, boolean>>({});

  protected toggleGroup(key: string, event: Event): void {
    const open = (event.target as HTMLDetailsElement).open;
    if (this.groups().find((g) => g.key === key)?.open !== open) {
      this.expanded.update((state) => ({ ...state, [key]: open }));
    }
  }

  protected readonly selected = computed<Match | undefined>(() => {
    const all = this.playable();
    return (
      all.find((m) => m.id === this.selectedId()) ??
      all.find((m) => m.status === 'live') ??
      all.find((m) => m.status === 'todo' && m.a.teamId && m.b.teamId) ??
      all[0]
    );
  });

  protected readonly entry = computed(() => {
    const m = this.selected();
    if (!m) return null;
    const t = this.t();
    const rules = matchRules(t, m);
    const result = evaluateMatch(m, rules);
    const ready = !!m.a.teamId && !!m.b.teamId;
    return {
      m,
      ready,
      tag: matchTag(m),
      rules: describeRules(rules),
      short: (side: Side) => this.ctx.slotName(m, side).replace(/^(Les|Le|La)\s+/i, ''),
      result,
      sets: m.sets.map((score, i) => {
        const winner = setWinner(score, i, rules);
        return {
          index: i,
          label: setLabel(i, rules),
          a: score[0],
          b: score[1],
          winner,
          disabled: !ready || m.status === 'done' || (!!result.winner && score[0] === null && score[1] === null),
        };
      }),
      verdict: !ready
        ? 'En attente des équipes qualifiées'
        : result.winner
          ? `Vainqueur : ${this.ctx.slotName(m, result.winner)}`
          : m.status === 'todo'
            ? 'Match à venir'
            : 'Match en cours',
      canValidate: !!result.winner && m.status !== 'done',
    };
  });

  protected readonly table = computed(() => {
    const m = this.selected();
    const t = this.t();
    if (!m) return null;
    if (m.phase === 'pool') {
      const pool = t.pools.find((p) => p.letter === m.pool && p.stage === m.stage);
      if (!pool) return null;
      if (t.format === 'mixer') {
        const stage = m.stage ?? 1;
        // À 16 équipes, les 2 premiers de chaque poule montent dans le groupe supérieur.
        const fourPools = stagePools(t, 1).length === 4;
        return {
          title: `Phase ${stage} · Poule ${pool.letter}`,
          subtitle: pool.name,
          rows: poolStandings(t, pool),
          qualified: stage < 3 && fourPools ? 2 : 0,
          note: mixerStageNote(t, stage),
        };
      }
      return {
        title: `Classement poule ${pool.letter}`,
        rows: poolStandings(t, pool),
        qualified: t.settings.qualifiersPerPool,
        note: `Les ${t.settings.qualifiersPerPool} premiers se qualifient pour la phase finale.`,
      };
    }
    if (m.phase === 'league') {
      return { title: 'Classement', rows: leagueStandings(t), qualified: 1, note: 'Le premier remporte le championnat.' };
    }
    return null;
  });

  protected select(id: string): void {
    this.selectedId.set(id);
  }

  protected setScore(m: Match, setIndex: number, side: Side, event: Event): void {
    const input = event.target as HTMLInputElement;
    const raw = input.value.trim();
    const value = raw === '' ? null : Math.min(99, Math.max(0, Math.round(Number(raw)) || 0));
    if (value !== null) input.value = String(value);
    this.ctx.store.setScore(this.t().id, m.id, setIndex, side, value);
  }

  protected validate(m: Match): void {
    this.ctx.store.validateMatch(this.t().id, m.id);
  }

  protected advance(): void {
    this.ctx.store.advance(this.t().id);
    this.filter.set('all');
    this.selectedId.set(null);
  }
}
