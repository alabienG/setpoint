import { Injectable, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { map } from 'rxjs';
import { Match, Side, Team } from '../../core/models';
import { TournamentStore } from '../../core/tournament.store';

/** Tournoi courant, résolu depuis le paramètre `:id` de la route. À fournir au niveau du composant de route. */
@Injectable()
export class TournamentContext {
  readonly store = inject(TournamentStore);
  readonly id = toSignal(inject(ActivatedRoute).paramMap.pipe(map((p) => p.get('id') ?? '')), { initialValue: '' });
  readonly tournament = computed(() => this.store.tournaments().find((t) => t.id === this.id()));
  readonly locked = computed(() => this.tournament()?.stage !== 'setup');
  readonly teamsById = computed(() => new Map<string, Team>((this.tournament()?.teams ?? []).map((t) => [t.id, t])));

  teamName(teamId: string | null, fallback = 'À déterminer'): string {
    return (teamId && this.teamsById().get(teamId)?.name) || fallback;
  }

  /** Nom d'une équipe d'un match, ou sa provenance (« Vainqueur Demi-finale 1 ») si elle n'est pas encore connue. */
  slotName(match: Match, side: Side, matches: readonly Match[] = this.tournament()?.matches ?? []): string {
    const slot = match[side];
    if (slot.teamId) return this.teamName(slot.teamId);
    if (slot.from) {
      const source = matches.find((m) => m.id === slot.from!.matchId);
      return `${slot.from.take === 'winner' ? 'Vainqueur' : 'Perdant'} ${source?.label ?? ''}`.trim();
    }
    return 'Exempt';
  }
}
