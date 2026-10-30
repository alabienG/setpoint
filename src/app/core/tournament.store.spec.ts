import { TestBed } from '@angular/core/testing';
import { Tournament } from './models';
import { ConflictError, TournamentRepository } from './storage/tournament-repository';
import { TournamentStore } from './tournament.store';

/** Faux serveur en mémoire, avec la même règle de version que l'API. */
class FakeRepository extends TournamentRepository {
  server = new Map<string, Tournament>();
  saves = 0;

  async loadAll(): Promise<Tournament[]> {
    return [...this.server.values()];
  }

  async get(id: string): Promise<Tournament> {
    return structuredClone(this.server.get(id)!);
  }

  async create(t: Tournament): Promise<Tournament> {
    const saved = { ...structuredClone(t), id: 'srv-1', slug: 'tournoi-abcd', version: 0 };
    this.server.set(saved.id, saved);
    return structuredClone(saved);
  }

  async save(t: Tournament): Promise<Tournament> {
    this.saves++;
    const current = this.server.get(t.id)!;
    if (current.version !== t.version) throw new ConflictError();
    const saved = { ...structuredClone(t), version: current.version! + 1 };
    this.server.set(t.id, saved);
    return structuredClone(saved);
  }

  async delete(id: string): Promise<void> {
    this.server.delete(id);
  }
}

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe('TournamentStore (API)', () => {
  let repo: FakeRepository;
  let store: TournamentStore;

  beforeEach(() => {
    repo = new FakeRepository();
    TestBed.configureTestingModule({
      providers: [TournamentStore, { provide: TournamentRepository, useValue: repo }],
    });
    store = TestBed.inject(TournamentStore);
  });

  it('utilise l’identifiant et l’adresse publique attribués par le serveur', async () => {
    const t = await store.create('Coupe');
    expect(t.id).toBe('srv-1');
    expect(t.slug).toBe('tournoi-abcd');
  });

  it('enregistre les modifications successives sans conflit avec elle-même', async () => {
    const t = await store.create('Coupe');
    store.addTeam(t.id, 'Les Smashers', 'Avancé');
    store.addTeam(t.id, 'Côté Filet', 'Intermédiaire');
    store.addTeam(t.id, 'Ace Lyon', 'Avancé');
    await settle();
    expect(repo.server.get(t.id)!.teams.map((team) => team.name)).toEqual(['Les Smashers', 'Côté Filet', 'Ace Lyon']);
    expect(store.get(t.id)!.version).toBe(repo.server.get(t.id)!.version);
  });

  it('rejoue la modification locale sur la version du serveur en cas de conflit', async () => {
    const t = await store.create('Coupe');
    // Un autre appareil ajoute une équipe pendant ce temps.
    const other = repo.server.get(t.id)!;
    repo.server.set(t.id, {
      ...other,
      version: other.version! + 1,
      teams: [{ id: 'x', name: 'Ajoutée ailleurs', level: 'Loisir', seed: false, color: 0 }],
    });

    store.addTeam(t.id, 'Ajoutée ici', 'Avancé');
    await settle();

    const names = repo.server.get(t.id)!.teams.map((team) => team.name);
    expect(names).toEqual(['Ajoutée ailleurs', 'Ajoutée ici']);
    expect(store.get(t.id)!.teams.map((team) => team.name)).toEqual(names);
    expect(store.saveError()).toBeNull();
  });
});
