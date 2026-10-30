import { inject } from '@angular/core';
import { Router, Routes } from '@angular/router';
import { organizerGuard } from './auth/organizer-auth.service';
import { ApiTournamentRepository } from './core/storage/api-tournament-repository';
import { TournamentRepository } from './core/storage/tournament-repository';
import { TournamentStore } from './core/tournament.store';

/**
 *   • / et /:slug : pages publiques (participants), sans connexion ;
 *   • /organisateur/** : gestion des compétitions, avec la connexion organisateur.
 */
export const routes: Routes = [
  {
    path: 'organisateur/connexion',
    title: 'Connexion organisateur — SetPoint',
    loadComponent: () => import('./auth/organizer-login-page').then((m) => m.OrganizerLoginPage),
  },
  {
    path: 'organisateur',
    canActivate: [organizerGuard],
    providers: [TournamentStore, { provide: TournamentRepository, useClass: ApiTournamentRepository }],
    children: [
      {
        path: ':id/matchs/:matchId/direct',
        title: 'Saisie en direct — SetPoint',
        loadComponent: () => import('./pages/live-score/live-score-page').then((m) => m.LiveScorePage),
      },
      {
        path: '',
        loadComponent: () => import('./layout/main-layout').then((m) => m.MainLayout),
        children: [
          {
            path: '',
            title: 'Tableau de bord — SetPoint',
            loadComponent: () => import('./pages/dashboard/dashboard-page').then((m) => m.DashboardPage),
          },
          {
            path: 'nouveau',
            canActivate: [
              async () => {
                const store = inject(TournamentStore);
                const router = inject(Router);
                const tournament = await store.create();
                return router.createUrlTree(['/organisateur', tournament.id, 'format']);
              },
            ],
            children: [],
          },
          {
            path: ':id',
            loadComponent: () => import('./pages/tournament/tournament-shell').then((m) => m.TournamentShell),
            children: [
              { path: '', pathMatch: 'full', redirectTo: 'format' },
              {
                path: 'format',
                title: 'Format — SetPoint',
                loadComponent: () => import('./pages/tournament/format/format-page').then((m) => m.FormatPage),
              },
              {
                path: 'participants',
                title: 'Participants — SetPoint',
                loadComponent: () =>
                  import('./pages/tournament/participants/participants-page').then((m) => m.ParticipantsPage),
              },
              {
                path: 'tirage',
                title: 'Tirage — SetPoint',
                loadComponent: () => import('./pages/tournament/draw/draw-page').then((m) => m.DrawPage),
              },
              {
                path: 'matchs',
                title: 'Matchs et scores — SetPoint',
                loadComponent: () => import('./pages/tournament/matches/matches-page').then((m) => m.MatchesPage),
              },
              {
                path: 'resultats',
                title: 'Résultats — SetPoint',
                loadComponent: () => import('./pages/tournament/results/results-page').then((m) => m.ResultsPage),
              },
            ],
          },
        ],
      },
    ],
  },
  {
    path: '',
    loadComponent: () => import('./layout/public-layout').then((m) => m.PublicLayout),
    children: [
      {
        path: '',
        title: 'Compétitions — SetPoint',
        loadComponent: () => import('./public/public-list-page').then((m) => m.PublicListPage),
      },
      {
        path: ':slug',
        title: 'Compétition — SetPoint',
        loadComponent: () => import('./public/public-competition-page').then((m) => m.PublicCompetitionPage),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
