import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { apiUrl } from '../api-url';
import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, firstValueFrom } from 'rxjs';
import { ORGANIZER_LOGIN_URL, OrganizerAuthService } from '../../auth/organizer-auth.service';
import { Tournament } from '../models';
import { ConflictError, TournamentRepository } from './tournament-repository';

const BASE_URL = apiUrl('/api/organizer/competitions');
/** Rafraîchissement depuis le serveur : prend en compte la saisie faite sur un autre appareil. */
const POLL_INTERVAL_MS = 15000;

/** Compétition telle que renvoyée par l'API. */
export interface CompetitionDto {
  uuid: string;
  slug: string;
  version: number;
  updatedAt: string;
  data: Omit<Tournament, 'slug' | 'version'>;
}

export function fromDto(dto: CompetitionDto): Tournament {
  return { ...dto.data, id: dto.uuid, slug: dto.slug, version: dto.version };
}

/** Compétitions stockées par l'API asperly, accessibles avec le jeton organisateur. */
@Injectable()
export class ApiTournamentRepository extends TournamentRepository {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(OrganizerAuthService);
  private readonly router = inject(Router);

  async loadAll(): Promise<Tournament[]> {
    return (await this.call(this.http.get<CompetitionDto[]>(BASE_URL, this.options()))).map(fromDto);
  }

  async get(id: string): Promise<Tournament> {
    return fromDto(await this.call(this.http.get<CompetitionDto>(`${BASE_URL}/${id}`, this.options())));
  }

  async create(tournament: Tournament): Promise<Tournament> {
    return fromDto(await this.call(this.http.post<CompetitionDto>(BASE_URL, toPayload(tournament), this.options())));
  }

  async save(tournament: Tournament): Promise<Tournament> {
    return fromDto(
      await this.call(this.http.put<CompetitionDto>(`${BASE_URL}/${tournament.id}`, toPayload(tournament), this.options())),
    );
  }

  async delete(id: string): Promise<void> {
    await this.call(this.http.delete<void>(`${BASE_URL}/${id}`, this.options()));
  }

  override watch(onChange: () => void): () => void {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && this.auth.token()) onChange();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }

  private options(): { headers: HttpHeaders } {
    return { headers: new HttpHeaders({ Authorization: `Bearer ${this.auth.token() ?? ''}` }) };
  }

  /** Traduit les réponses d'erreur : session expirée → page de connexion, version périmée → ConflictError. */
  private async call<T>(request: Observable<T>): Promise<T> {
    try {
      return await firstValueFrom(request);
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 401) {
        this.auth.logout();
        void this.router.navigate([ORGANIZER_LOGIN_URL], { queryParams: { returnUrl: this.router.url } });
      }
      if (error instanceof HttpErrorResponse && error.status === 409) throw new ConflictError();
      throw error;
    }
  }
}

function toPayload(tournament: Tournament): { version: number | undefined; data: Omit<Tournament, 'slug' | 'version'> } {
  const { slug: _slug, version, ...data } = tournament;
  return { version, data };
}
