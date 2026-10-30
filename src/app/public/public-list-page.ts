import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { formatName } from '../domain/formats';
import { CompetitionSummary, PublicCompetitionsApi } from './public-competitions-api';

const STAGE_ORDER = { running: 0, setup: 1, finished: 2 } as const;

@Component({
  selector: 'app-public-list-page',
  imports: [RouterLink, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="page">
      <div>
        <span class="eyebrow">Compétitions</span>
        <h1 class="display display-xl">Matchs & résultats</h1>
      </div>
      @if (competitions(); as list) {
        <div class="grid">
          @for (c of list; track c.slug) {
            <a class="card item" [routerLink]="['/', c.slug]">
              <span class="row">
                @switch (c.stage) {
                  @case ('running') { <span class="pill pill--live">En cours</span> }
                  @case ('finished') { <span class="pill pill--neutral">Terminé</span> }
                  @default { <span class="pill pill--info">À venir</span> }
                }
                <span class="muted small">
                  @if (c.date) {
                    {{ c.date | date: 'd MMM y' : '' : 'fr' }}
                  }
                </span>
              </span>
              <strong class="name">{{ c.name }}</strong>
              <span class="muted small">{{ formatLabel(c) }}</span>
            </a>
          } @empty {
            <p class="muted">Aucune compétition pour le moment.</p>
          }
        </div>
      } @else if (failed()) {
        <p class="notice notice--warn">Les compétitions ne peuvent pas être chargées pour le moment.</p>
      }
    </main>
  `,
  styles: `
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 16px;
    }
    .item {
      gap: 10px;
      color: var(--ink);
      text-decoration: none;
      &:hover {
        color: var(--ink);
        border-color: var(--line-strong);
      }
    }
    .row {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .name {
      font-size: 19px;
    }
    .small {
      font-size: 13px;
    }
  `,
})
export class PublicListPage {
  private readonly result = toSignal(
    inject(PublicCompetitionsApi)
      .list()
      .pipe(
        map((list) => ({ list: [...list].sort((x, y) => STAGE_ORDER[x.stage] - STAGE_ORDER[y.stage]) })),
        catchError(() => of({ list: null })),
      ),
  );
  protected readonly competitions = computed(() => this.result()?.list ?? null);
  protected readonly failed = computed(() => this.result() !== undefined && this.result()!.list === null);

  protected formatLabel(c: CompetitionSummary): string {
    return formatName(c.format);
  }
}
