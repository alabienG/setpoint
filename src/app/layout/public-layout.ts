import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';

/** En-tête des pages publiques (participants, sans connexion). */
@Component({
  selector: 'app-public-layout',
  imports: [RouterOutlet, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="no-print">
      <div class="bar">
        <a routerLink="/" class="brand">
          <svg width="30" height="30" viewBox="0 0 32 32" fill="none" stroke="#FB7A3C" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
            <circle cx="16" cy="16" r="13" />
            <path d="M16 3c-2 6-1 13 6 19" />
            <path d="M4.5 10c6 1 12 4 15 12" />
            <path d="M27 12c-6-1-14 1-19 9" />
          </svg>
          <span class="wordmark">Set<span>Point</span></span>
        </a>
        <a routerLink="/organisateur" class="organizer">Espace organisateur</a>
      </div>
    </header>
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
      min-height: 64px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
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
    .organizer {
      color: var(--on-navy-muted);
      font-size: 14px;
      font-weight: 600;
      &:hover {
        color: #fff;
      }
    }
    @media (max-width: 640px) {
      header {
        padding: 0 16px;
      }
    }
  `,
})
export class PublicLayout {}
