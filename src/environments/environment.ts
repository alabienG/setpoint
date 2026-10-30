/**
 * Configuration de l'application.
 *
 * `apiBaseUrl` : adresse du serveur qui héberge l'API (sans `/api` ni `/` final).
 * Vide en développement : `ng serve` redirige `/api` vers http://localhost:8080 (proxy.conf.json).
 * En production, la CI GitHub Pages réécrit ce fichier avec la variable `API_BASE_URL` du dépôt.
 */
export const environment = {
  apiBaseUrl: '',
};
