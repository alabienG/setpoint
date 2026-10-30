import { Tournament } from '../models';

/** Levée par `save` quand la compétition a été modifiée ailleurs depuis la version connue. */
export class ConflictError extends Error {
  constructor() {
    super('La compétition a été modifiée entre-temps');
  }
}

/** Accès aux compétitions de l'organisateur. L'implémentation est fournie au niveau des routes. */
export abstract class TournamentRepository {
  abstract loadAll(): Promise<Tournament[]>;
  abstract get(id: string): Promise<Tournament>;
  /** Enregistre une nouvelle compétition ; le résultat porte l'identifiant et l'adresse publique du serveur. */
  abstract create(tournament: Tournament): Promise<Tournament>;
  /** Enregistre la compétition sur la base de sa `version` ; lève ConflictError si elle est périmée. */
  abstract save(tournament: Tournament): Promise<Tournament>;
  abstract delete(id: string): Promise<void>;

  /** Notifie les modifications faites ailleurs (autre appareil). Renvoie une fonction de désabonnement. */
  watch(_onChange: () => void): () => void {
    return () => {};
  }
}
