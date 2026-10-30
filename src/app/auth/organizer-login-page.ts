import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { OrganizerAuthService } from './organizer-auth.service';

@Component({
  selector: 'app-organizer-login-page',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="screen">
      <form class="card login" (submit)="submit($event)">
        <div class="brand">
          <svg width="34" height="34" viewBox="0 0 32 32" fill="none" stroke="#FB7A3C" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
            <circle cx="16" cy="16" r="13" />
            <path d="M16 3c-2 6-1 13 6 19" />
            <path d="M4.5 10c6 1 12 4 15 12" />
            <path d="M27 12c-6-1-14 1-19 9" />
          </svg>
          <span class="wordmark">Set<span>Point</span></span>
        </div>
        <h1 class="display display-l">Espace organisateur</h1>
        <label class="field">
          Identifiant
          <input type="text" name="username" autocomplete="username" required [value]="username()" (input)="username.set($any($event.target).value)" />
        </label>
        <label class="field">
          Mot de passe
          <input type="password" name="password" autocomplete="current-password" required [value]="password()" (input)="password.set($any($event.target).value)" />
        </label>
        @if (error()) {
          <p class="notice notice--warn" role="alert">{{ error() }}</p>
        }
        <button type="submit" class="btn btn--primary btn--lg" [disabled]="busy() || !username() || !password()">
          {{ busy() ? 'Connexion…' : 'Se connecter' }}
        </button>
        <a routerLink="/" class="public-link">Voir les résultats publics</a>
      </form>
    </main>
  `,
  styles: `
    .screen {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px 16px;
      background: var(--navy);
    }
    .login {
      width: 100%;
      max-width: 400px;
      gap: 18px;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .wordmark {
      font-family: var(--font-display);
      font-weight: 800;
      font-size: 28px;
      text-transform: uppercase;
      color: var(--navy);
      span {
        color: var(--orange);
      }
    }
    .notice {
      margin: 0;
    }
    .public-link {
      text-align: center;
      font-size: 14px;
    }
  `,
})
export class OrganizerLoginPage {
  private readonly auth = inject(OrganizerAuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly username = signal('');
  protected readonly password = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    this.busy.set(true);
    this.error.set('');
    try {
      await this.auth.login(this.username().trim(), this.password());
      const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
      await this.router.navigateByUrl(returnUrl?.startsWith('/organisateur') ? returnUrl : '/organisateur');
    } catch (error) {
      const status = error instanceof HttpErrorResponse ? error.status : 0;
      this.error.set(
        status === 401
          ? 'Identifiant ou mot de passe incorrect.'
          : status === 429
            ? 'Trop de tentatives. Réessayez dans quelques minutes.'
            : status === 503
              ? 'La connexion organisateur n’est pas configurée sur le serveur.'
              : 'Connexion impossible pour le moment.',
      );
    } finally {
      this.busy.set(false);
    }
  }
}
