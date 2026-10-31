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

Formats disponibles : poules + phase finale, poules brassées (12, 15 ou 16 paires en 4 contre 4), élimination directe, championnat.

### Poules brassées (12, 15 ou 16 paires, 4 contre 4)

Chaque équipe inscrite est une paire. Les matchs se jouent en 4 contre 4 : dans chaque poule de
4 paires, A+B contre C+D, A+C contre B+D, A+D contre B+C (3 matchs, chaque paire joue les trois
avec un partenaire différent). Le classement reste individuel par paire : écart cumulé de son camp.

À 16 paires (4 poules), selon le modèle de l'organisateur :

1. Poules de niveau homogène, 1 set de 19 pts, plafond 21, 20 min.
2. Principale (1ers et 2es) et consolante (3es et 4es), 1 set de 25, plafond 27, 25 min.
3. Poules des places 1-4, 5-8, 9-12 et 13-16, 1 set de 25, 30 min.

Une phase = 12 matchs en 4 tours sur 3 terrains (une poule au repos par tour). À 12 paires
(3 poules) : phase 2 par rang (principale, intermédiaire, consolante), puis montée / descente.

À 15 paires : 3 poules de 5. Chaque poule joue 5 matchs avec une paire au repos à chacun (elle arbitre
le match de sa poule en auto-arbitrage) ; chaque paire joue 4 matchs, est partenaire une fois de chacune
des 4 autres et les affronte deux fois. Phase = 15 matchs en 5 tours. Brassage comme à 12 paires,
phase 3 : places 1-5, 6-10, 11-15.

À partir de la phase 2, le niveau de chaque paire (Principale, Intermédiaire, Consolante, puis
Places 1 à 4…) est mis en évidence par une pastille dans les classements, et le classement général
est découpé par niveau.

Départage : deux paires à égalité d'écart jouent un barrage en 2 contre 2, en 6 points (la première
à 6 gagne), créé automatiquement dès que la poule a joué ses 3 matchs et programmé à la suite de la
phase. Il ne compte pas dans l'écart. À trois paires ou plus, chacune affronte les autres, puis
victoires et écart en barrage. (La confrontation directe ne peut pas départager : dans une poule de
4 paires, deux paires à égalité d'écart le sont aussi sur les deux matchs où elles s'affrontent.)

### Auto-arbitrage

Option de l'étape Format, avant le tirage : chaque match est arbitré par une équipe qui ne joue pas
sur ce créneau ; on choisit toujours celle qui a le moins arbitré (sur tout le tournoi), de préférence
dans la même poule. Chaque match mobilisant trois équipes, le planning ne programme pas plus de
matchs simultanés que le nombre d'équipes divisé par trois. En poules, l'écart entre équipes est d'au
plus un arbitrage en championnat ; en poules brassées et en tableau final, il peut monter à deux
(seules les paires de la poule au repos, ou les équipes déjà éliminées, sont libres). Logique : `src/app/domain/referees.ts`.

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
