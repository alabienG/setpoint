# SetPoint

Front de gestion des compétitions de volley (Angular 21), publié sur GitHub Pages.
Les données sont stockées par l'API Bon-Coach (dépôt `alabienG/bon-coach`, routes
`/api/competitions/**` et `/api/organizer/**`), servie en HTTPS sous `https://<domaine>/boncoach`.

## Démarrer en local

```bash
npm install
npm start        # http://localhost:4200, /api redirigé vers http://localhost:8080
npm test         # tests unitaires (Vitest)
```

Lancer l'API Bon-Coach en local sur le port 8080 avec un compte organisateur de développement :

```bash
cd ../v-coach/backend
COMPETITIONS_ORGANIZER_USERNAME=organisateur COMPETITIONS_ORGANIZER_PASSWORD=DevOrga123! ./mvnw spring-boot:run
```

## Pages

| Route | Accès | Contenu |
| --- | --- | --- |
| `/` | public | Liste des compétitions |
| `/:slug` | public | Matchs en direct, classements, résultats (actualisés toutes les 15 s) |
| `/organisateur/connexion` | — | Connexion organisateur |
| `/organisateur` | organisateur | Tableau de bord |
| `/organisateur/:id/format` … `/resultats` | organisateur | Format, participants, tirage, matchs & scores, résultats |
| `/organisateur/:id/matchs/:matchId/direct` | organisateur | Saisie point par point sur mobile |

Formats disponibles : poules + phase finale, poules brassées (9 à 16 équipes), élimination directe, championnat.

### Poules brassées (9 à 16 équipes)

Trois phases de poules de 4 (ou de 3 quand il manque des équipes) ; 4 poules de 13 à 16 équipes, 3 poules de 9 à 12.

À 16 équipes, selon le modèle de l'organisateur :

1. Poules de niveau homogène, 1 set de 19 pts, plafond 21, 20 min.
2. Principale (1ers et 2es) et consolante (3es et 4es), 1 set de 25, plafond 27, 25 min.
3. Poules des places 1-4, 5-8, 9-12 et 13-16, 1 set de 25, 30 min.

À 12 équipes : phase 2 par rang (principale, intermédiaire, consolante), puis montée / descente.
Les places du brassage qui n'existent pas restent vides ; une poule réduite à 2 équipes récupère
la dernière équipe de la poule de 4 la plus proche au-dessus.

Classement d'une poule : total de points marqués ; deux équipes à égalité se départagent à la confrontation directe.

### Import des participants

Liste simple (`Nom;Niveau`) ou feuille d'inscription en binômes (blocs « Equipe N »), depuis un fichier CSV
ou le lien d'une Google Sheet partagée. Le niveau d'une paire est la moyenne de celui de ses joueurs
(barème `CATEGORY_RATINGS` dans `src/app/domain/team-import.ts`), modifiable équipe par équipe.

## Déploiement (GitHub Pages)

Le workflow `.github/workflows/deploy-pages.yml` teste, construit et publie l'application à chaque push sur `main`.

Une fois le dépôt créé sur GitHub :

1. **Settings → Pages** : source « GitHub Actions ».
2. **Settings → Secrets and variables → Actions → Variables** :
   - `API_BASE_URL` : adresse de l'API Bon-Coach, **en HTTPS**, sans `/api` (ex. `https://<domaine>/boncoach`) ;
   - `BASE_HREF` (optionnel) : `/` pour un domaine personnalisé, sinon `/<nom du dépôt>/` par défaut.
3. Côté Bon-Coach, renseigner dans le `.env` du serveur `COMPETITIONS_ORGANIZER_USERNAME`,
   `COMPETITIONS_ORGANIZER_PASSWORD` et `COMPETITIONS_JWT_SECRET` (cf. `backend/.env.example`).
   Le CORS de Bon-Coach est déjà ouvert : rien à configurer pour l'origine GitHub Pages.

GitHub Pages est toujours servi en HTTPS : l'API doit l'être aussi (sinon le navigateur bloque les appels).

## Architecture

```
src/app/
  core/
    models.ts                    Types du domaine (Tournament, Team, Match…)
    tournament.store.ts          État (signaux), enregistrement en arrière-plan, reprise sur conflit
    storage/                     TournamentRepository + implémentation HTTP (API Bon-Coach)
    api-url.ts                   Adresse de l'API (src/environments/environment.ts)
  auth/                          Connexion organisateur (identifiants fixes vérifiés par l'API)
  domain/                        Logique pure : score, tirage, tableaux, brassage, classements
  layout/                        En-têtes organisateur et public
  pages/                         Écrans organisateur
  public/                        Pages publiques
  shared/                        Icônes, avatars, helpers d'affichage
```

Chaque modification est appliquée à l'écran puis enregistrée. Si la compétition a été modifiée sur un autre
appareil entre-temps (version périmée, HTTP 409), le store recharge la version du serveur et y rejoue
les modifications en attente.
