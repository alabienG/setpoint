import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { formatName } from '../../domain/formats';
import { Icon } from '../../shared/icon';
import { TournamentContext } from './tournament-context';

interface Step {
  path: string;
  label: string;
  done: boolean;
}

@Component({
  selector: 'app-tournament-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon],
  providers: [TournamentContext],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (ctx.tournament(); as t) {
      <main class="page">
        <div class="heading">
          <span class="crumbs no-print"><a routerLink="/organisateur">Tournois</a> / {{ t.name }}</span>
          <div class="title-row">
            <h1 class="display display-xl">{{ t.name }}</h1>
            <span class="pill pill--info">{{ formatLabel() }} · {{ t.teams.length }} équipes</span>
            @switch (t.stage) {
              @case ('running') { <span class="pill pill--live">En cours</span> }
              @case ('finished') { <span class="pill pill--neutral">Terminé</span> }
            }
          </div>
          @if (t.slug) {
            <div class="public no-print">
              <span>Page publique pour les participants :</span>
              <a [routerLink]="['/', t.slug]" target="_blank">{{ publicUrl() }}</a>
              <button type="button" class="btn btn--outline copy" (click)="copyPublicUrl()">
                {{ copied() ? 'Lien copié' : 'Copier le lien' }}
              </button>
            </div>
          }
        </div>

        <nav class="steps no-print" aria-label="Étapes du tournoi">
          @for (step of steps(); track step.path; let i = $index) {
            <a [routerLink]="step.path" routerLinkActive="current" ariaCurrentWhenActive="step" [class.done]="step.done">
              <span class="bubble">
                @if (step.done) {
                  <app-icon name="check" [size]="14" [strokeWidth]="3" />
                } @else {
                  {{ i + 1 }}
                }
              </span>
              {{ step.label }}
            </a>
          }
        </nav>

        <router-outlet />
      </main>
    } @else if (ctx.store.loaded()) {
      <main class="page">
        <div class="card">
          <h1 class="display display-l">Tournoi introuvable</h1>
          <p class="muted">Ce tournoi n’existe pas ou a été supprimé de ce navigateur.</p>
          <a routerLink="/organisateur" class="btn btn--primary">Retour au tableau de bord</a>
        </div>
      </main>
    }
  `,
  styles: `
    .heading {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .crumbs {
      font-size: 14px;
      color: var(--muted);
      a {
        color: var(--muted);
      }
    }
    .title-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 12px;
    }
    .public {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px 12px;
      font-size: 14px;
      color: var(--muted);
      a {
        font-weight: 600;
        word-break: break-all;
      }
      .copy {
        min-height: 36px;
        padding: 0 12px;
        font-size: 13px;
      }
    }
    .steps {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      a {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        min-height: 44px;
        padding: 0 16px 0 8px;
        border-radius: 999px;
        background: #fff;
        border: 1px solid var(--line);
        color: var(--ink-2);
        text-decoration: none;
        font-weight: 500;
        font-size: 14px;
      }
      .bubble {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        background: var(--track);
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      a.done .bubble {
        background: var(--blue);
        color: #fff;
      }
      a.current {
        background: var(--navy);
        border-color: var(--navy);
        color: #fff;
        font-weight: 600;
        .bubble {
          background: var(--orange);
          color: #fff;
        }
      }
    }
  `,
})
export class TournamentShell {
  protected readonly ctx = inject(TournamentContext);

  protected readonly formatLabel = computed(() => formatName(this.ctx.tournament()?.format ?? 'pools'));
  /** Adresse publique complète, y compris le sous-chemin de déploiement (GitHub Pages). */
  protected readonly publicUrl = computed(() => new URL(this.ctx.tournament()?.slug ?? '', document.baseURI).href);
  protected readonly copied = signal(false);

  protected async copyPublicUrl(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.publicUrl());
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch {
      /* Presse-papiers indisponible : le lien reste affiché et sélectionnable. */
    }
  }

  protected readonly steps = computed<Step[]>(() => {
    const t = this.ctx.tournament();
    const started = !!t && t.stage !== 'setup';
    const finished = t?.stage === 'finished';
    return [
      { path: 'format', label: 'Format', done: started || (t?.teams.length ?? 0) > 0 },
      { path: 'participants', label: 'Participants', done: started },
      { path: 'tirage', label: 'Tirage', done: started },
      { path: 'matchs', label: 'Matchs & scores', done: finished },
      { path: 'resultats', label: 'Résultats', done: finished },
    ];
  });
}
