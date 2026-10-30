import { HttpClient } from '@angular/common/http';
import { apiUrl } from '../core/api-url';
import { Injectable, computed, inject, signal } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

const SESSION_KEY = 'asperly:competitions:organizer';
export const ORGANIZER_LOGIN_URL = '/organisateur/connexion';

interface Session {
  token: string;
  expiresAt: string;
}

/**
 * Connexion de l'organisateur des compétitions : identifiants fixes vérifiés par l'API,
 * indépendante de la connexion admin du site. Le jeton est gardé jusqu'à son expiration
 * (une journée de tournoi), y compris après un rechargement de la page.
 */
@Injectable({ providedIn: 'root' })
export class OrganizerAuthService {
  private readonly http = inject(HttpClient);
  private readonly session = signal<Session | null>(readSession());

  readonly isLoggedIn = computed(() => isValid(this.session()));

  /** Jeton à envoyer à l'API, ou null si la session a expiré. */
  token(): string | null {
    const session = this.session();
    return isValid(session) ? session!.token : null;
  }

  async login(username: string, password: string): Promise<void> {
    const session = await firstValueFrom(
      this.http.post<{ accessToken: string; expiresAt: string }>(apiUrl('/api/competitions/auth/login'), { username, password }),
    );
    const next = { token: session.accessToken, expiresAt: session.expiresAt };
    this.session.set(next);
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(next));
    } catch {
      /* Stockage indisponible : la session reste valable jusqu'au rechargement. */
    }
  }

  logout(): void {
    this.session.set(null);
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
  }
}

function readSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function isValid(session: Session | null): boolean {
  return !!session && new Date(session.expiresAt).getTime() > Date.now();
}

/** Réserve les écrans organisateur aux personnes connectées. */
export const organizerGuard: CanActivateFn = (_route, state) => {
  if (inject(OrganizerAuthService).token()) return true;
  return inject(Router).createUrlTree([ORGANIZER_LOGIN_URL], { queryParams: { returnUrl: state.url } });
};
