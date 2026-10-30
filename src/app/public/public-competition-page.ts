import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom, map } from 'rxjs';
import { Match, Tournament } from '../core/models';
import { matchTime } from '../domain/draw';
import { formatName } from '../domain/formats';
import { TeamStats, evaluateMatch, playedSets } from '../domain/scoring';
import {
  RankingRow,
  currentStage,
  finalRanking,
  leagueStandings,
  matchRules,
  poolStandings,
  progress,
} from '../domain/tournament-engine';
import { matchTag, matchTagClass } from '../shared/match-display';
import { TeamAvatar } from '../shared/team-avatar';
import { PublicCompetitionsApi } from './public-competitions-api';

const REFRESH_MS = 15000;

type Tab = 'matches' | 'standings' | 'results';
type NameOf = (teamId: string | null) => string;

function toCard(t: Tournament, m: Match, name: NameOf) {
  const rules = matchRules(t, m);
  const result = evaluateMatch(m, rules);
  const single = rules.setsToWin === 1;
  const started = m.status !== 'todo';
  return {
    m,
    tag: matchTag(m),
    time: matchTime(m, t.settings),
    a: name(m.a.teamId),
    b: name(m.b.teamId),
    // En set unique on affiche les points, sinon les sets gagnés.
    scoreA: started ? (single ? result.pointsA : result.setsA) : '–',
    scoreB: started ? (single ? result.pointsB : result.setsB) : '–',
    winner: m.status === 'done' ? result.winner : null,
    detail: single ? '' : playedSets(m).map((s) => `${s[0]}-${s[1]}`).join(' · '),
  };
}

function toRows(stats: TeamStats[], name: NameOf) {
  return stats.map((row, i) => ({ ...row, rank: i + 1, name: name(row.teamId), diff: row.pointsFor - row.pointsAgainst }));
}

type Card = ReturnType<typeof toCard>;

/** Page publique d'une compétition : matchs en direct, classements et résultats, sans connexion. */
@Component({
  selector: 'app-public-competition-page',
  imports: [RouterLink, DatePipe, NgTemplateOutlet, TeamAvatar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './public-competition-page.html',
  styleUrl: './public-competition-page.scss',
})
export class PublicCompetitionPage {
  private readonly api = inject(PublicCompetitionsApi);
  private readonly slug = toSignal(inject(ActivatedRoute).paramMap.pipe(map((p) => p.get('slug') ?? '')), {
    initialValue: '',
  });

  protected readonly t = signal<Tournament | null>(null);
  protected readonly notFound = signal(false);
  protected readonly updatedAt = signal<Date | null>(null);
  private readonly chosenTab = signal<Tab | null>(null);
  protected readonly tagClass = matchTagClass;

  protected readonly tab = computed<Tab>(() => this.chosenTab() ?? (this.t()?.stage === 'finished' ? 'results' : 'matches'));
  protected readonly tabs: { id: Tab; label: string }[] = [
    { id: 'matches', label: 'Matchs' },
    { id: 'standings', label: 'Classements' },
    { id: 'results', label: 'Résultats' },
  ];

  protected readonly formatLabel = computed(() => formatName(this.t()?.format ?? 'pools'));
  protected readonly progress = computed(() => (this.t() ? progress(this.t()!) : { done: 0, total: 0 }));
  private readonly name = computed<NameOf>(() => {
    const teams = new Map((this.t()?.teams ?? []).map((team) => [team.id, team.name]));
    return (id) => (id && teams.get(id)) || 'À déterminer';
  });

  /** Matchs regroupés par phase ; seule la phase en cours est dépliée. */
  protected readonly groups = computed(() => {
    const t = this.t();
    if (!t) return [];
    const groups: { key: string; title: string; cards: Card[] }[] = [];
    const matches = t.matches.filter((m) => !m.bye).sort((x, y) => x.slot - y.slot || x.court - y.court);
    for (const m of matches) {
      const key = m.stage ? `s${m.stage}` : m.phase;
      const title = m.stage
        ? `Phase ${m.stage}`
        : m.phase === 'bracket'
          ? 'Phase finale'
          : t.format === 'league'
            ? 'Championnat'
            : 'Phase de poules';
      let group = groups.find((g) => g.key === key);
      if (!group) groups.push((group = { key, title, cards: [] }));
      group.cards.push(toCard(t, m, this.name()));
    }
    return groups.map((g, i) => ({ ...g, open: i === groups.length - 1 }));
  });

  protected readonly live = computed(() => this.groups().flatMap((g) => g.cards).filter((c) => c.m.status === 'live'));

  /** Classements de poule, la phase la plus récente d'abord (dépliée). */
  protected readonly standings = computed(() => {
    const t = this.t();
    if (!t || t.stage === 'setup') return [];
    if (t.format === 'league') {
      return [{ key: 'league', title: 'Classement', open: true, pools: [{ title: '', rows: toRows(leagueStandings(t), this.name()) }] }];
    }
    const stages = t.format === 'mixer' ? Array.from({ length: currentStage(t) }, (_, i) => currentStage(t) - i) : [undefined];
    return stages.map((stage, i) => ({
      key: `s${stage ?? 0}`,
      title: stage ? `Phase ${stage}` : 'Poules',
      open: i === 0,
      pools: t.pools
        .filter((p) => p.stage === stage)
        .map((p) => ({
          title: `Poule ${p.letter}${p.name && !p.name.startsWith('Niveau') ? ` · ${p.name}` : ''}`,
          rows: toRows(poolStandings(t, p), this.name()),
        })),
    }));
  });

  protected readonly pointsOnly = computed(() => this.t()?.format === 'mixer');
  protected readonly ranking = computed<RankingRow[]>(() =>
    this.t() && this.t()!.stage !== 'setup' ? finalRanking(this.t()!) : [],
  );
  protected readonly podium = computed(() => {
    if (this.t()?.stage !== 'finished') return [];
    const [first, second, third] = this.ranking();
    const steps: { row: RankingRow; place: number }[] = [];
    if (second) steps.push({ row: second, place: 2 });
    if (first) steps.push({ row: first, place: 1 });
    if (third) steps.push({ row: third, place: 3 });
    return steps;
  });

  constructor() {
    void this.refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void this.refresh();
    }, REFRESH_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  protected selectTab(tab: Tab): void {
    this.chosenTab.set(tab);
  }

  private async refresh(): Promise<void> {
    if (!this.slug()) return;
    try {
      this.t.set(await firstValueFrom(this.api.get(this.slug())));
      this.updatedAt.set(new Date());
      this.notFound.set(false);
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 404) this.notFound.set(true);
    }
  }
}
