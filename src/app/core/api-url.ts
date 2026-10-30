import { environment } from '../../environments/environment';

/** URL complète d'un chemin de l'API (« /api/... »), sur le serveur configuré. */
export function apiUrl(path: string): string {
  return `${environment.apiBaseUrl.replace(/\/+$/, '')}${path}`;
}
