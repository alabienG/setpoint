import { DEFAULT_SETTINGS, Match, Team, Tournament } from '../core/models';
import { buildBracket, resolveBracket, seedOrder } from './bracket';
import { distributeIntoPools, roundRobin, schedule } from './draw';
import { estimateMatches } from './formats';
import { emptySets, evaluateMatch, setWinner, standings } from './scoring';
import { googleSheetCsvUrl, parseTeams } from './team-import';
import {
  canGenerateFinals,
  canGenerateNextStage,
  drawBlockers,
  finalRanking,
  generateDraw,
  generateFinals,
  generateNextStage,
  matchRules,
  normalize,
  poolStandings,
  stagePools,
} from './tournament-engine';

const settings = DEFAULT_SETTINGS;

function team(i: number, seed = false): Team {
  return { id: `t${i}`, name: `Équipe ${i}`, level: 'Intermédiaire', seed, color: i };
}

function tournament(format: Tournament['format'], teamCount: number): Tournament {
  return {
    id: 'x',
    name: 'Test',
    createdAt: '2026-01-01T00:00:00Z',
    date: null,
    format,
    settings,
    teams: Array.from({ length: teamCount }, (_, i) => team(i + 1, i < 2)),
    drawMode: 'seeds',
    drawSeed: 42,
    drawRound: 1,
    pools: [],
    matches: [],
    stage: 'setup',
  };
}

/** Fait gagner l'équipe A (sets nets) à chaque match jouable, dans l'ordre, jusqu'à stabilité. */
function playAll(t: Tournament): Tournament {
  let current = t;
  for (let guard = 0; guard < 100; guard++) {
    const next = current.matches.find((m) => m.status !== 'done' && m.a.teamId && m.b.teamId);
    if (!next) break;
    const rules = matchRules(current, next);
    const sets = emptySets(rules);
    for (let i = 0; i < rules.setsToWin; i++) sets[i] = [rules.pointsPerSet, rules.pointsPerSet - 5];
    current = normalize({
      ...current,
      matches: current.matches.map((m) => (m.id === next.id ? { ...m, sets, status: 'done' } : m)),
    });
  }
  return current;
}

describe('scoring', () => {
  it('exige 2 points d’écart et le score cible', () => {
    expect(setWinner([25, 23], 0, settings)).toBe('a');
    expect(setWinner([25, 24], 0, settings)).toBeNull();
    expect(setWinner([26, 28], 0, settings)).toBe('b');
    expect(setWinner([15, 13], 2, settings)).toBe('a');
    expect(setWinner([15, 13], 1, settings)).toBeNull();
  });

  it('désigne le vainqueur au meilleur des 3 sets', () => {
    const match = { sets: [[25, 20], [20, 25], [15, 10]] } as Match;
    expect(evaluateMatch(match, settings)).toMatchObject({ setsA: 2, setsB: 1, winner: 'a' });
  });

  it('attribue 3/0 pour une victoire nette et 2/1 au set décisif', () => {
    const base = { phase: 'pool', status: 'done', slot: 0, court: 1, round: 1, label: '' } as const;
    const matches: Match[] = [
      { ...base, id: '1', a: { teamId: 'a' }, b: { teamId: 'b' }, sets: [[25, 10], [25, 10], [null, null]] },
      { ...base, id: '2', a: { teamId: 'a' }, b: { teamId: 'c' }, sets: [[25, 10], [10, 25], [15, 12]] },
    ];
    const table = standings(['a', 'b', 'c'], matches, settings);
    expect(table.map((r) => [r.teamId, r.rankingPoints])).toEqual([
      ['a', 5],
      ['c', 1],
      ['b', 0],
    ]);
  });
});

describe('tirage', () => {
  it('génère un tous contre tous complet', () => {
    const rounds = roundRobin(['a', 'b', 'c', 'd', 'e']);
    const pairs = rounds.flat().map((p) => [...p].sort().join(''));
    expect(new Set(pairs).size).toBe(10);
  });

  it('répartit en serpentin', () => {
    const pools = distributeIntoPools(['1', '2', '3', '4', '5', '6', '7', '8'], 2);
    expect(pools.map((p) => p.teamIds)).toEqual([
      ['1', '4', '5', '8'],
      ['2', '3', '6', '7'],
    ]);
  });

  it('sépare les têtes de série dans des poules différentes', () => {
    const draw = generateDraw(tournament('pools', 8));
    expect(draw.pools.map((p) => p.teamIds.filter((id) => ['t1', 't2'].includes(id)).length)).toEqual([1, 1]);
    expect(draw.matches).toHaveLength(12);
  });

  it('ne fait jamais jouer une équipe deux fois sur le même créneau', () => {
    const draw = generateDraw({ ...tournament('league', 7), settings: { ...settings, courts: 3 } });
    const seen = new Set<string>();
    for (const m of draw.matches) {
      for (const id of [m.a.teamId, m.b.teamId]) {
        const key = `${m.slot}-${id}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
      expect(m.court).toBeLessThanOrEqual(3);
    }
  });

  it('estime le nombre de matchs comme la maquette', () => {
    expect(estimateMatches('pools', settings)).toBe('16 matchs pour 8 équipes');
    expect(estimateMatches('league', settings)).toBe('28 matchs pour 8 équipes');
  });
});

describe('tableau final', () => {
  it('place les têtes de série 1 et 2 aux extrémités', () => {
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });

  it('gère les exemptions et fait avancer les vainqueurs', () => {
    const bracket = resolveBracket(buildBracket(['a', 'b', 'c', 'd', 'e', 'f'], settings, 'm'), settings);
    const byes = bracket.filter((m) => m.bye);
    expect(byes.map((m) => m.a.teamId)).toEqual(['a', 'b']);
    const semis = bracket.filter((m) => m.label.startsWith('Demi'));
    expect(semis[0].a.teamId).toBe('a');
    const scheduled = schedule(bracket, settings);
    expect(scheduled.filter((m) => m.label.startsWith('Demi')).every((m) => m.slot > 0)).toBe(true);
  });

  it('enchaîne poules, phase finale et classement final', () => {
    let t = tournament('pools', 8);
    t = { ...t, ...generateDraw(t), stage: 'running' };
    t = playAll(t);
    expect(canGenerateFinals(t)).toBe(true);
    t = normalize({ ...t, matches: [...t.matches, ...generateFinals(t)] });
    expect(t.matches.filter((m) => m.phase === 'bracket')).toHaveLength(4);
    t = playAll(t);
    expect(t.stage).toBe('finished');
    const ranking = finalRanking(t);
    expect(ranking.slice(0, 4).map((r) => r.journey)).toEqual(['Champion', 'Finaliste', '3e place', 'Demi-finaliste']);
    expect(ranking).toHaveLength(8);
  });

  it('termine une élimination directe à 5 équipes', () => {
    let t = tournament('elim', 5);
    t = { ...t, ...generateDraw(t), stage: 'running' };
    t = playAll(t);
    expect(t.stage).toBe('finished');
    expect(finalRanking(t)[0].journey).toBe('Champion');
  });
});

describe('set unique avec plafond', () => {
  const phase1 = DEFAULT_SETTINGS.phases[0];

  it('gagne à 19 avec 2 points d’écart, ou au plafond de 21', () => {
    expect(setWinner([19, 17], 0, phase1)).toBe('a');
    expect(setWinner([19, 18], 0, phase1)).toBeNull();
    expect(setWinner([20, 21], 0, phase1)).toBe('b');
    expect(evaluateMatch({ sets: [[21, 20]] } as Match, phase1)).toMatchObject({ setsA: 1, winner: 'a' });
  });

  it('classe aux victoires puis à l’écart de points', () => {
    const base = { phase: 'pool', status: 'done', slot: 0, court: 1, round: 1, label: '' } as const;
    const matches: Match[] = [
      { ...base, id: '1', a: { teamId: 'a' }, b: { teamId: 'b' }, sets: [[19, 5]] },
      { ...base, id: '2', a: { teamId: 'c' }, b: { teamId: 'd' }, sets: [[19, 17]] },
    ];
    expect(standings(['a', 'b', 'c', 'd'], matches, phase1).map((r) => r.teamId)).toEqual(['a', 'c', 'd', 'b']);
  });
});

describe('poules brassées', () => {
  function mixer(): Tournament {
    const t = tournament('mixer', 16);
    return {
      ...t,
      drawMode: 'level',
      settings: { ...DEFAULT_SETTINGS, courts: 3, maxTeams: 16 },
      teams: t.teams.map((team, i) => ({ ...team, seed: false, rating: 5 - Math.floor(i / 4) })),
    };
  }

  it('forme des poules de niveau homogène', () => {
    const draw = generateDraw(mixer());
    expect(draw.pools.map((p) => p.teamIds.map((id) => Number(id.slice(1))).sort((a, b) => a - b))).toEqual([
      [1, 2, 3, 4],
      [5, 6, 7, 8],
      [9, 10, 11, 12],
      [13, 14, 15, 16],
    ]);
    expect(draw.matches).toHaveLength(24);
    expect(draw.matches[0].start).toBe(9 * 60);
  });

  it('brasse selon le modèle et classe de 1 à 16', () => {
    let t = mixer();
    t = { ...t, ...generateDraw(t), stage: 'running' };
    t = playAll(t);
    expect(canGenerateNextStage(t)).toBe(true);

    const r1 = stagePools(t, 1).map((p) => poolStandings(t, p).map((row) => row.teamId));
    let next = generateNextStage(t);
    expect(next.pools[0].teamIds).toEqual([r1[0][0], r1[2][0], r1[1][1], r1[3][1]]);
    expect(next.pools[3].teamIds).toEqual([r1[1][2], r1[3][2], r1[0][3], r1[2][3]]);
    // La phase 2 commence après les 8 créneaux de 20 minutes de la phase 1.
    expect(Math.min(...next.matches.map((m) => m.start!))).toBe(9 * 60 + 8 * 20);
    t = playAll({ ...t, pools: [...t.pools, ...next.pools], matches: [...t.matches, ...next.matches] });

    const r2 = stagePools(t, 2).map((p) => poolStandings(t, p).map((row) => row.teamId));
    next = generateNextStage(t);
    expect(next.pools[0].teamIds).toEqual([r2[0][0], r2[0][1], r2[1][0], r2[1][1]]);
    t = playAll({ ...t, pools: [...t.pools, ...next.pools], matches: [...t.matches, ...next.matches] });

    expect(t.matches).toHaveLength(72);
    expect(t.stage).toBe('finished');
    const ranking = finalRanking(t);
    expect(ranking).toHaveLength(16);
    expect(ranking[0].teamId).toBe(poolStandings(t, stagePools(t, 3)[0])[0].teamId);
    expect(ranking[8].teamId).toBe(poolStandings(t, stagePools(t, 3)[2])[0].teamId);
  });
});

describe('import des équipes', () => {
  it('lit la feuille d’inscription en binômes', () => {
    const csv = [
      'Tournoi 4x4 dimanche 26 octobre,,,,,,,',
      ',Equipe 1,,,,Joueurs/Joueuses disponibles,,',
      ',Prénom,Equipe,,,,Prénom,Equipe',
      '1,Arthur,Masculine Mouv,,,1,Nicolas,Mixte Fun',
      '2,Kévin,Masculine Mouv,,,2,,Féminine FSGT',
      ',Equipe 2,,,,4,,Participation à confirmer',
      '3,Fanny,Mixte Mouv,,,,,',
      '4,Clément,Departementale,,,,,',
      ',Equipe 14,,,,,,',
      '27,,Mixte Mouv,,,,,',
      '28,,Mixte Fun,,,,,',
    ].join('\n');
    expect(parseTeams(csv)).toEqual([
      { name: 'Arthur / Kévin', players: [{ name: 'Arthur', category: 'Masculine Mouv' }, { name: 'Kévin', category: 'Masculine Mouv' }], rating: 4, level: 'Avancé' },
      { name: 'Fanny / Clément', players: [{ name: 'Fanny', category: 'Mixte Mouv' }, { name: 'Clément', category: 'Departementale' }], rating: 4, level: 'Avancé' },
      { name: 'Équipe 14', players: [{ name: '', category: 'Mixte Mouv' }, { name: '', category: 'Mixte Fun' }], rating: 2.5, level: 'Loisir' },
    ]);
  });

  it('construit l’URL d’export CSV de l’onglet partagé', () => {
    expect(googleSheetCsvUrl('https://docs.google.com/spreadsheets/d/abc_1/edit?pli=1&gid=42#gid=42')).toBe(
      'https://docs.google.com/spreadsheets/d/abc_1/export?format=csv&gid=42',
    );
    expect(googleSheetCsvUrl('https://example.com')).toBeNull();
  });
});

describe('poules brassées à 12 équipes', () => {
  it('enchaîne 3 phases de 3 poules et classe de 1 à 12', () => {
    const base = tournament('mixer', 12);
    let t: Tournament = {
      ...base,
      drawMode: 'level',
      settings: { ...DEFAULT_SETTINGS, courts: 3, maxTeams: 12 },
      teams: base.teams.map((team, i) => ({ ...team, seed: false, rating: 5 - Math.floor(i / 4) })),
    };
    t = { ...t, ...generateDraw(t), stage: 'running' };
    expect(t.pools).toHaveLength(3);
    expect(t.matches).toHaveLength(18);
    t = playAll(t);

    const r1 = stagePools(t, 1).map((p) => poolStandings(t, p).map((row) => row.teamId));
    let next = generateNextStage(t);
    expect(next.pools.map((p) => p.name)).toEqual(['Principale', 'Intermédiaire', 'Consolante']);
    expect(next.pools[0].teamIds).toEqual([r1[0][0], r1[1][0], r1[2][0], r1[0][1]]);
    t = playAll({ ...t, pools: [...t.pools, ...next.pools], matches: [...t.matches, ...next.matches] });

    const r2 = stagePools(t, 2).map((p) => poolStandings(t, p).map((row) => row.teamId));
    next = generateNextStage(t);
    // Montée / descente : le 4e de la poule 1 descend, le 1er de la poule 2 monte.
    expect(next.pools[0].teamIds).toEqual([r2[0][0], r2[0][1], r2[0][2], r2[1][0]]);
    expect(next.pools[1].teamIds).toContain(r2[0][3]);
    t = playAll({ ...t, pools: [...t.pools, ...next.pools], matches: [...t.matches, ...next.matches] });

    expect(t.matches).toHaveLength(54);
    expect(t.stage).toBe('finished');
    const ranking = finalRanking(t);
    expect(new Set(ranking.map((r) => r.teamId)).size).toBe(12);
    expect(ranking[4].teamId).toBe(poolStandings(t, stagePools(t, 3)[1])[0].teamId);
  });

  it('bloque le tirage en dehors de 9 à 16 équipes', () => {
    expect(drawBlockers(tournament('mixer', 8))).toEqual(['Le format « Poules brassées » se joue de 9 à 16 équipes (8 inscrites).']);
    expect(drawBlockers(tournament('mixer', 11))).toEqual([]);
  });
});

describe('poules brassées avec poules de 3', () => {
  function play(teamCount: number): Tournament {
    const base = tournament('mixer', teamCount);
    let t: Tournament = {
      ...base,
      drawMode: 'level',
      settings: { ...DEFAULT_SETTINGS, courts: 3, maxTeams: 16 },
      teams: base.teams.map((team, i) => ({ ...team, seed: false, rating: 5 - i / 4 })),
    };
    t = { ...t, ...generateDraw(t), stage: 'running' };
    t = playAll(t);
    for (const _ of [2, 3]) {
      const next = generateNextStage(t);
      t = playAll({ ...t, pools: [...t.pools, ...next.pools], matches: [...t.matches, ...next.matches] });
    }
    return t;
  }

  for (let n = 9; n <= 16; n++) {
    it(`joue un tournoi complet à ${n} équipes avec des poules de 3 ou 4`, () => {
      const t = play(n);
      for (const stage of [1, 2, 3]) {
        const sizes = stagePools(t, stage).map((p) => p.teamIds.length);
        expect(sizes.every((s) => s === 3 || s === 4)).toBe(true);
        expect(sizes.reduce((a, b) => a + b, 0)).toBe(n);
        expect(new Set(stagePools(t, stage).flatMap((p) => p.teamIds)).size).toBe(n);
      }
      expect(t.stage).toBe('finished');
      const ranking = finalRanking(t);
      expect(new Set(ranking.map((r) => r.teamId)).size).toBe(n);
      expect(stagePools(t, 3).at(-1)!.name).toMatch(new RegExp(`à ${n}$`));
    });
  }

  it('met la poule de 3 en dernier à 15 équipes et garde le modèle de brassage', () => {
    const t = play(15);
    expect(stagePools(t, 1).map((p) => p.teamIds.length)).toEqual([4, 4, 4, 3]);
    expect(stagePools(t, 3).map((p) => p.name)).toEqual(['Places 1 à 4', 'Places 5 à 8', 'Places 9 à 12', 'Places 13 à 15']);
    // La poule de 3 joue 3 matchs par phase au lieu de 6.
    expect(t.matches.filter((m) => m.stage === 1 && m.pool === '4')).toHaveLength(3);
  });
});

describe('classement des poules brassées', () => {
  const base = { phase: 'pool', status: 'done', slot: 0, court: 1, round: 1, label: '', pool: '1', stage: 1 } as const;

  function pool(matches: Match[]): string[] {
    const t: Tournament = {
      ...tournament('mixer', 4),
      pools: [{ letter: '1', stage: 1, teamIds: ['t1', 't2', 't3', 't4'] }],
      matches,
    };
    return poolStandings(t, t.pools[0]).map((r) => r.teamId);
  }

  it('classe au total de points marqués, même avec moins de victoires', () => {
    // t2 gagne 1 match et marque 39 points ; t3 en gagne 2 mais ne marque que 38 points.
    expect(
      pool([
        { ...base, id: '1', a: { teamId: 't1' }, b: { teamId: 't2' }, sets: [[21, 20]] },
        { ...base, id: '2', a: { teamId: 't3' }, b: { teamId: 't4' }, sets: [[19, 2]] },
        { ...base, id: '3', a: { teamId: 't2' }, b: { teamId: 't3' }, sets: [[19, 0]] },
        { ...base, id: '4', a: { teamId: 't3' }, b: { teamId: 't1' }, sets: [[19, 4]] },
      ]),
    ).toEqual(['t2', 't3', 't1', 't4']);
  });

  it('départage deux équipes à égalité de points par la confrontation directe', () => {
    // t1 et t2 ont 36 points chacun ; t2 a battu t1.
    expect(
      pool([
        { ...base, id: '1', a: { teamId: 't1' }, b: { teamId: 't2' }, sets: [[17, 19]] },
        { ...base, id: '2', a: { teamId: 't1' }, b: { teamId: 't3' }, sets: [[19, 0]] },
        { ...base, id: '3', a: { teamId: 't2' }, b: { teamId: 't4' }, sets: [[17, 19]] },
      ]),
    ).toEqual(['t2', 't1', 't4', 't3']);
  });
});
