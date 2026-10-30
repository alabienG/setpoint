import { HttpClient } from '@angular/common/http';
import { apiUrl } from '../core/api-url';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { FormatId, Tournament, TournamentStage } from '../core/models';
import { CompetitionDto, fromDto } from '../core/storage/api-tournament-repository';

export interface CompetitionSummary {
  slug: string;
  name: string;
  stage: TournamentStage;
  date: string | null;
  format: FormatId;
  updatedAt: string;
}

/** Lecture publique des compétitions, sans connexion. */
@Injectable({ providedIn: 'root' })
export class PublicCompetitionsApi {
  private readonly http = inject(HttpClient);

  list(): Observable<CompetitionSummary[]> {
    return this.http.get<CompetitionSummary[]>(apiUrl('/api/competitions'));
  }

  get(slug: string): Observable<Tournament> {
    return this.http.get<CompetitionDto>(apiUrl(`/api/competitions/${encodeURIComponent(slug)}`)).pipe(map(fromDto));
  }
}
