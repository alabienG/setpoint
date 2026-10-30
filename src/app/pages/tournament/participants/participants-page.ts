import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LEVELS, Level, Team, Tournament } from '../../../core/models';
import { teamRating } from '../../../domain/draw';
import { ImportedTeam, googleSheetCsvUrl, parseTeams } from '../../../domain/team-import';
import { Icon } from '../../../shared/icon';
import { TeamAvatar } from '../../../shared/team-avatar';
import { TournamentContext } from '../tournament-context';

@Component({
  selector: 'app-participants-page',
  imports: [RouterLink, Icon, TeamAvatar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './participants-page.html',
  styleUrl: './participants-page.scss',
})
export class ParticipantsPage {
  protected readonly ctx = inject(TournamentContext);
  protected readonly levels = LEVELS;
  protected readonly ratings = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];
  protected readonly draft = signal('');
  protected readonly level = signal<Level>('Intermédiaire');
  protected readonly sheetLink = signal('');
  protected readonly importing = signal(false);
  protected readonly message = signal('');

  protected readonly t = computed(() => this.ctx.tournament() as Tournament);
  protected readonly locked = this.ctx.locked;
  protected readonly count = computed(() => this.t().teams.length);
  protected readonly max = computed(() => this.t().settings.maxTeams);
  protected readonly full = computed(() => this.count() >= this.max());
  protected readonly byLevel = computed(() => this.t().format === 'mixer' || this.t().drawMode === 'level');
  protected readonly seedHint = computed(() => {
    switch (this.t().format) {
      case 'mixer':
        return 'Au tirage, les paires sont regroupées par niveau pour des poules homogènes : ajustez les niveaux si besoin.';
      case 'pools':
        return 'Les têtes de série seront placées dans des poules différentes lors du tirage.';
      case 'elim':
        return 'Les têtes de série sont placées pour ne se croiser qu’en fin de tableau.';
      default:
        return 'Toutes les équipes se rencontrent : les têtes de série n’influencent que l’ordre des matchs.';
    }
  });

  protected rating(team: Team): number {
    return teamRating(team);
  }

  protected add(event: Event): void {
    event.preventDefault();
    if (!this.draft().trim() || this.full()) return;
    this.ctx.store.addTeam(this.t().id, this.draft(), this.level());
    this.draft.set('');
    this.message.set('');
  }

  protected toggleSeed(teamId: string): void {
    this.ctx.store.toggleSeed(this.t().id, teamId);
  }

  protected setRating(teamId: string, event: Event): void {
    this.ctx.store.setTeamRating(this.t().id, teamId, Number((event.target as HTMLSelectElement).value));
  }

  protected remove(teamId: string): void {
    this.ctx.store.removeTeam(this.t().id, teamId);
  }

  protected async importCsv(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.importRows(parseTeams(await file.text()));
  }

  protected async importSheet(event: Event): Promise<void> {
    event.preventDefault();
    const url = googleSheetCsvUrl(this.sheetLink());
    if (!url) {
      this.message.set('Ce lien n’est pas celui d’une Google Sheet.');
      return;
    }
    this.importing.set(true);
    try {
      const response = await fetch(url);
      if (!response.ok || !response.headers.get('content-type')?.includes('text/csv')) throw new Error();
      this.importRows(parseTeams(await response.text()));
      this.sheetLink.set('');
    } catch {
      this.message.set('Lecture impossible : vérifiez que la feuille est partagée « à toute personne disposant du lien ».');
    } finally {
      this.importing.set(false);
    }
  }

  private importRows(rows: ImportedTeam[]): void {
    if (!rows.length) {
      this.message.set('Aucune équipe trouvée dans ce fichier.');
      return;
    }
    const added = this.ctx.store.importTeams(this.t().id, rows);
    const skipped = rows.length - added;
    this.message.set(
      `${added} équipe${added > 1 ? 's' : ''} importée${added > 1 ? 's' : ''}` +
        (skipped > 0 ? ` · ${skipped} ignorée${skipped > 1 ? 's' : ''} (doublon ou plus de place)` : '') +
        '.',
    );
  }
}
