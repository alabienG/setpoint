import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { Side } from '../../core/models';
import { currentSetIndex, evaluateMatch, isDecidingSet, maxSets, setCap, setTarget, setWinner } from '../../domain/scoring';
import { matchRules } from '../../domain/tournament-engine';
import { Icon } from '../../shared/icon';
import { matchTag } from '../../shared/match-display';
import { TournamentContext } from '../tournament/tournament-context';

interface LogEntry {
  side: Side;
  previousServe: Side | null;
}

/** Saisie point par point depuis le bord du terrain, pensée pour le mobile. */
@Component({
  selector: 'app-live-score-page',
  imports: [RouterLink, Icon],
  providers: [TournamentContext],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './live-score-page.html',
  styleUrl: './live-score-page.scss',
})
export class LiveScorePage {
  private readonly matchId = toSignal(inject(ActivatedRoute).paramMap.pipe(map((p) => p.get('matchId') ?? '')), {
    initialValue: '',
  });

  protected readonly ctx = inject(TournamentContext);
  protected readonly serve = signal<Side | null>(null);
  private readonly log = signal<LogEntry[]>([]);

  protected readonly backLink = computed(() => ['/organisateur', this.ctx.id(), 'matchs']);
  protected readonly match = computed(() => this.ctx.tournament()?.matches.find((m) => m.id === this.matchId()));
  protected readonly state = computed(() => {
    const m = this.match();
    if (!m || !m.a.teamId || !m.b.teamId) return null;
    const settings = matchRules(this.ctx.tournament()!, m);
    const result = evaluateMatch(m, settings);
    const lastPlayed = m.sets.reduce((last, s, i) => (s[0] !== null ? i : last), 0);
    const index = m.liveSet ?? currentSetIndex(m, settings) ?? lastPlayed;
    const score = m.sets[index] ?? [null, null];
    const target = setTarget(index, settings);
    const cap = setCap(index, settings);
    const decisive = isDecidingSet(index, settings);
    const single = maxSets(settings) === 1;
    const setWon = setWinner(score, index, settings);
    const over = !!result.winner;
    const names = { a: this.ctx.teamName(m.a.teamId), b: this.ctx.teamName(m.b.teamId) };

    let hint = `${single ? 'Set unique' : `Set ${index + 1}`} en ${target} points, 2 points d’écart${cap !== null ? ` (plafond ${cap})` : ''}`;
    if (setWon) hint = `Set remporté par ${names[setWon]}`;
    if (over) hint = `Match terminé — vainqueur : ${names[result.winner!]}`;

    return {
      m,
      index,
      over,
      setWon,
      done: m.status === 'done',
      single,
      where: `${matchTag(m)} · Terrain ${m.court}`,
      referee: m.referee ? this.ctx.teamName(m.referee) : null,
      setLabel: m.status === 'done' || over ? 'TERMINÉ' : single ? 'SET UNIQUE' : decisive ? 'SET DÉCISIF' : `SET ${index + 1}`,
      history: m.sets.slice(0, index).map((s, i) => `S${i + 1} · ${s[0] ?? 0}-${s[1] ?? 0}`),
      hint,
      sides: (['a', 'b'] as const).map((side) => ({
        side,
        name: names[side],
        points: score[side === 'a' ? 0 : 1] ?? 0,
        sets: side === 'a' ? result.setsA : result.setsB,
        wonSet: setWon === side,
      })),
    };
  });

  protected point(side: Side): void {
    const s = this.state();
    if (!s || s.setWon || s.over || s.done) return;
    this.log.update((log) => [...log, { side, previousServe: this.serve() }]);
    this.serve.set(side);
    this.ctx.store.addPoint(this.ctx.id(), s.m.id, s.index, side, 1);
  }

  protected remove(side: Side): void {
    const s = this.state();
    if (!s || s.done || s.sides.find((x) => x.side === side)!.points === 0) return;
    this.ctx.store.addPoint(this.ctx.id(), s.m.id, s.index, side, -1);
  }

  protected undo(): void {
    const s = this.state();
    const last = this.log().at(-1);
    if (!s || !last || s.done) return;
    this.ctx.store.addPoint(this.ctx.id(), s.m.id, s.index, last.side, -1);
    this.serve.set(last.previousServe);
    this.log.update((log) => log.slice(0, -1));
  }

  protected readonly canUndo = computed(() => this.log().length > 0 && !this.state()?.done);

  protected next(): void {
    const s = this.state();
    if (!s || s.done) return;
    if (s.over) {
      this.ctx.store.validateMatch(this.ctx.id(), s.m.id);
    } else if (s.setWon) {
      this.ctx.store.setLiveSet(this.ctx.id(), s.m.id, s.index + 1);
      this.log.set([]);
    }
  }
}
