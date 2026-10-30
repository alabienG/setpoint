import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ORGANIZER_LOGIN_URL, OrganizerAuthService } from '../auth/organizer-auth.service';
import { TournamentStore } from '../core/tournament.store';
import { Icon } from '../shared/icon';

@Component({
  selector: 'app-main-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="no-print">
      <div class="bar">
        <a routerLink="/organisateur" class="brand">
          <svg width="30" height="30" viewBox="0 0 32 32" fill="none" stroke="#FB7A3C" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
            <circle cx="16" cy="16" r="13" />
            <path d="M16 3c-2 6-1 13 6 19" />
            <path d="M4.5 10c6 1 12 4 15 12" />
            <path d="M27 12c-6-1-14 1-19 9" />
          </svg>
          <span class="wordmark">Set<span>Point</span></span>
        </a>
        <nav aria-label="Navigation principale">
          <a routerLink="/organisateur" routerLinkActive="active" ariaCurrentWhenActive="page" [routerLinkActiveOptions]="{ exact: true }">
            Tableau de bord
          </a>
          <a routerLink="/">Pages publiques</a>
        </nav>
        <div class="actions">
          <a routerLink="/organisateur/nouveau" class="btn btn--primary">
            <app-icon name="plus" [strokeWidth]="2.4" />
            Nouveau tournoi
          </a>
          <button type="button" class="logout" (click)="logout()">Se déconnecter</button>
        </div>
      </div>
    </header>
    @if (saveError(); as error) {
      <p class="save-error no-print" role="alert">{{ error }}</p>
    }
    <router-outlet />
  `,
  styles: `
    header {
      background: var(--navy);
      color: #fff;
      padding: 0 24px;
    }
    .bar {
      max-width: 1280px;
      margin: 0 auto;
      min-height: 68px;
      padding: 12px 0;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 12px 32px;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      color: #fff;
      text-decoration: none;
    }
    .wordmark {
      font-family: var(--font-display);
      font-weight: 800;
      font-size: 26px;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      span {
        color: var(--orange-bright);
      }
    }
    nav {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      flex: 1 1 auto;
      a {
        padding: 10px 14px;
        border-radius: 8px;
        color: var(--on-navy-muted);
        text-decoration: none;
        font-size: 15px;
        font-weight: 500;
        &:hover {
          color: #fff;
        }
        &.active {
          background: rgba(255, 255, 255, 0.1);
          color: #fff;
          font-weight: 600;
        }
      }
    }
    .actions {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .logout {
      min-height: 44px;
      padding: 0 14px;
      border: 1px solid rgba(255, 255, 255, 0.25);
      border-radius: 10px;
      background: transparent;
      color: var(--on-navy-muted);
      font-weight: 600;
      cursor: pointer;
      &:hover {
        color: #fff;
        border-color: #fff;
      }
    }
    .save-error {
      margin: 0;
      padding: 10px 24px;
      background: var(--orange-soft);
      color: var(--orange-dark);
      font-weight: 600;
      text-align: center;
    }
    @media (max-width: 640px) {
      header {
        padding: 0 16px;
      }
    }
  `,
})
export class MainLayout {
  private readonly auth = inject(OrganizerAuthService);
  private readonly router = inject(Router);
  protected readonly saveError = inject(TournamentStore).saveError;

  protected logout(): void {
    this.auth.logout();
    void this.router.navigate([ORGANIZER_LOGIN_URL]);
  }
}
