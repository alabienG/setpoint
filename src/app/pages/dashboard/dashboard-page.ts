import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, isDevMode, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Match, Tournament } from '../../core/models';
import { TournamentStore } from '../../core/tournament.store';
import { formatName } from '../../domain/formats';
import { finalRanking, matchRules, progress } from '../../domain/tournament-engine';
import { currentSetIndex, maxSets, setLabel } from '../../domain/scoring';
import { Icon } from '../../shared/icon';
import { matchTag } from '../../shared/match-display';

type Filter = 'all' | 'active' | 'finished';

interface LiveCard {
  key: string;
  link: string[];
  where: string;
  setLabel: string;
  rows: { name: string; previous: (number | null)[]; current: number | null; leading: boolean }[];
}

@Component({
  selector: 'app-dashboard-page',
  imports: [RouterLink, DatePipe, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard-page.html',
  styleUrl: './dashboard-page.scss',
})
export class DashboardPage {
  private readonly store = inject(TournamentStore);
  private readonly router = inject(Router);

  protected readonly filter = signal<Filter>('all');
  protected readonly filters: { id: Filter; label: string }[] = [
    { id: 'all', label: 'Tous' },
    { id: 'active', label: 'En cours' },
    { id: 'finished', label: 'Terminés' },
  ];
  protected readonly loaded = this.store.loaded;
  /** Le tournoi d'exemple n'est proposé qu'en développement, pour ne pas polluer les données réelles. */
  protected readonly devMode = isDevMode();
  protected readonly hasTournaments = computed(() => this.store.tournaments().length > 0);

  protected readonly cards = computed(() =>
    this.store
      .tournaments()
      .filter((t) => {
        const f = this.filter();
        if (f === 'active') return t.stage !== 'finished';
        if (f === 'finished') return t.stage === 'finished';
        return true;
      })
      .map((t) => {
        const p = progress(t);
        return {
          t,
          format: formatName(t.format),
          link: ['/organisateur', t.id, t.stage === 'setup' ? (t.teams.length ? 'participants' : 'format') : t.stage === 'running' ? 'matchs' : 'resultats'],
          winner: t.stage === 'finished' ? finalRanking(t)[0]?.team.name : undefined,
          done: p.done,
          total: p.total,
          percent: t.stage === 'setup' ? (t.teams.length / Math.max(1, t.settings.maxTeams)) * 100 : (p.done / Math.max(1, p.total)) * 100,
        };
      }),
  );

  protected readonly live = computed<LiveCard[]>(() =>
    this.store
      .tournaments()
      .filter((t) => t.stage === 'running')
      .flatMap((t) => t.matches.filter((m) => m.status === 'live').map((m) => this.liveCard(t, m)))
      .slice(0, 4),
  );

  protected readonly firstLiveLink = computed(() => this.live()[0]?.link ?? null);

  protected async loadDemo(): Promise<void> {
    const t = await this.store.createDemo();
    await this.router.navigate(['/organisateur', t.id, 'matchs']);
  }

  private liveCard(t: Tournament, m: Match): LiveCard {
    const rules = matchRules(t, m);
    const index = m.liveSet ?? currentSetIndex(m, rules) ?? 0;
    const name = (id: string | null) => t.teams.find((team) => team.id === id)?.name ?? '?';
    const current = m.sets[index] ?? [null, null];
    return {
      key: t.id + m.id,
      link: ['/organisateur', t.id, 'matchs'],
      where: `${matchTag(m)} · Terrain ${m.court}`,
      setLabel: maxSets(rules) === 1 ? 'En cours' : setLabel(index, rules),
      rows: (['a', 'b'] as const).map((side, i) => ({
        name: name(m[side].teamId),
        previous: m.sets.slice(0, index).map((s) => s[i]),
        current: current[i],
        leading: (current[i] ?? 0) > (current[1 - i] ?? 0),
      })),
    };
  }
}
