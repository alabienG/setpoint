import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormatId, Tournament, TournamentSettings } from '../../../core/models';
import {
  FORMATS,
  MIXER_MAX_TEAMS,
  MIXER_MIN_TEAMS,
  estimateMatches,
  formatName,
  mixerPoolCount,
  mixerPoolSizes,
} from '../../../domain/formats';
import { Icon } from '../../../shared/icon';
import { TournamentContext } from '../tournament-context';
import { FormatIcon } from './format-icon';

type NumericSetting = 'pointsPerSet' | 'decidingSetPoints' | 'courts' | 'maxTeams' | 'poolCount' | 'qualifiersPerPool';

@Component({
  selector: 'app-format-page',
  imports: [RouterLink, Icon, FormatIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './format-page.html',
  styleUrl: './format-page.scss',
})
export class FormatPage {
  protected readonly ctx = inject(TournamentContext);
  private readonly router = inject(Router);

  protected readonly t = computed(() => this.ctx.tournament() as Tournament);
  protected readonly locked = this.ctx.locked;
  protected readonly formats = computed(() =>
    FORMATS.map((f) => ({ ...f, estimate: estimateMatches(f.id, this.t().settings) })),
  );
  protected readonly selectedName = computed(() => formatName(this.t().format));
  protected readonly minTeams = computed(() => Math.max(2, this.t().teams.length));
  protected readonly mixer = computed(() => this.t().format === 'mixer');
  protected readonly mixerMin = MIXER_MIN_TEAMS;
  protected readonly mixerMax = MIXER_MAX_TEAMS;
  protected readonly mixerMinMax = computed(() => Math.max(MIXER_MIN_TEAMS, this.t().teams.length));
  /** Nombre d'équipes pris en compte pour décrire les poules : les inscrits, sinon la capacité. */
  private readonly mixerTeams = computed(() => {
    const t = this.t();
    const n = t.teams.length >= MIXER_MIN_TEAMS ? t.teams.length : t.settings.maxTeams;
    return Math.min(MIXER_MAX_TEAMS, Math.max(MIXER_MIN_TEAMS, n));
  });
  protected readonly mixerPools = computed(() => mixerPoolCount(this.mixerTeams()));
  protected readonly mixerLayout = computed(() => {
    const sizes = mixerPoolSizes(this.mixerTeams());
    const fours = sizes.filter((s) => s === 4).length;
    const threes = sizes.length - fours;
    const parts = [fours && `${fours} poule${fours > 1 ? 's' : ''} de 4`, threes && `${threes} poule${threes > 1 ? 's' : ''} de 3`];
    return `${this.mixerTeams()} équipes → ${parts.filter(Boolean).join(' et ')}`;
  });

  protected rename(event: Event): void {
    this.ctx.store.rename(this.t().id, (event.target as HTMLInputElement).value);
  }

  protected setDate(event: Event): void {
    this.ctx.store.setDate(this.t().id, (event.target as HTMLInputElement).value);
  }

  protected pick(format: FormatId): void {
    this.ctx.store.setFormat(this.t().id, format);
  }

  protected setSets(setsToWin: TournamentSettings['setsToWin']): void {
    this.ctx.store.updateSettings(this.t().id, { setsToWin });
  }

  protected setNumber(key: NumericSetting, event: Event, min: number, max: number): void {
    this.ctx.store.updateSettings(this.t().id, { [key]: this.readNumber(event, min, max) });
  }

  protected setCap(event: Event): void {
    this.ctx.store.updateSettings(this.t().id, { cap: this.readCap(event) });
  }

  protected setPhasePoints(index: number, event: Event): void {
    const value = this.readNumber(event, 5, 50);
    this.ctx.store.updatePhase(this.t().id, index, { pointsPerSet: value, decidingSetPoints: value });
  }

  protected setPhaseCap(index: number, event: Event): void {
    this.ctx.store.updatePhase(this.t().id, index, { cap: this.readCap(event) });
  }

  protected setPhaseMinutes(index: number, event: Event): void {
    this.ctx.store.updatePhase(this.t().id, index, { minutes: this.readNumber(event, 5, 120) });
  }

  /** Un plafond vide (ou à 0) signifie « pas de plafond ». */
  private readCap(event: Event): number | null {
    const input = event.target as HTMLInputElement;
    const value = Math.round(Number(input.value));
    if (!input.value.trim() || !value) {
      input.value = '';
      return null;
    }
    return value;
  }

  private readNumber(event: Event, min: number, max: number): number {
    const input = event.target as HTMLInputElement;
    const value = Math.min(max, Math.max(min, Math.round(Number(input.value) || min)));
    input.value = String(value);
    return value;
  }

  protected setStartTime(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    if (value) this.ctx.store.updateSettings(this.t().id, { startTime: value });
  }

  protected async remove(): Promise<void> {
    if (!confirm(`Supprimer définitivement « ${this.t().name} » ?`)) return;
    await this.ctx.store.remove(this.t().id);
    await this.router.navigate(['/organisateur']);
  }
}
