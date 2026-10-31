import { DEFAULT_SETTINGS, Match, Team, Tournament } from '../core/models';
import { buildBracket, resolveBracket, seedOrder } from './bracket';
import { distributeIntoPools, mixerRotations, roundRobin, schedule } from './draw';
import { estimateMatches } from './formats';
import { emptySets, evaluateMatch, matchTeams, setWinner, standings } from './scoring';
import { refereeCounts } from './referees';
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
  withLevelStarts,
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

describe('poules brassées (4 contre 4)', () => {
  function mixer(n: number): Tournament {
    const base = tournament('mixer', n);
    return {
      ...base,
      drawMode: 'level',
      settings: { ...DEFAULT_SETTINGS, courts: 3, maxTeams: n },
      teams: base.teams.map((team, i) => ({ ...team, seed: false, rating: 5 - Math.floor(i / 4) })),
    };
  }

  function nextStage(t: Tournament): Tournament {
    const next = generateNextStage(t);
    return playAll(normalize({ ...t, pools: [...t.pools, ...next.pools], matches: [...t.matches, ...next.matches] }));
  }

  it('forme des poules de niveau homogène, chacune jouant 3 matchs en 4 contre 4', () => {
    const draw = generateDraw(mixer(16));
    expect(draw.pools.map((p) => p.teamIds.map((id) => Number(id.slice(1))).sort((a, b) => a - b))).toEqual([
      [1, 2, 3, 4],
      [5, 6, 7, 8],
      [9, 10, 11, 12],
      [13, 14, 15, 16],
    ]);
    expect(draw.matches).toHaveLength(12);
    const [a, b, c, d] = draw.pools[0].teamIds;
    const pool1 = draw.matches.filter((m) => m.pool === '1');
    expect(pool1.map((m) => [[m.a.teamId, m.a.partnerId], [m.b.teamId, m.b.partnerId]])).toEqual([
      [[a, b], [c, d]],
      [[a, c], [b, d]],
      [[a, d], [b, c]],
    ]);
    // Comme le modèle : 4 tours de 3 terrains, une poule au repos à chaque tour.
    expect(Math.max(...draw.matches.map((m) => m.slot))).toBe(3);
    expect(draw.matches[0].start).toBe(9 * 60);
  });

  it('donne à chaque paire le résultat de son camp', () => {
    let t = mixer(16);
    t = { ...t, ...generateDraw(t), stage: 'running' };
    const first = t.matches.find((m) => m.pool === '1' && m.round === 1)!;
    t = normalize({
      ...t,
      matches: t.matches.map((m) => (m.id === first.id ? { ...m, sets: [[19, 15]], status: 'done' } : m)),
    });
    const rows = new Map(poolStandings(t, t.pools[0]).map((r) => [r.teamId, r]));
    for (const id of [first.a.teamId!, first.a.partnerId!]) expect(rows.get(id)).toMatchObject({ wins: 1, pointsFor: 19, pointsAgainst: 15 });
    for (const id of [first.b.teamId!, first.b.partnerId!]) expect(rows.get(id)).toMatchObject({ losses: 1, pointsFor: 15, pointsAgainst: 19 });
  });

  it('brasse selon le modèle et classe de 1 à 16', () => {
    let t = mixer(16);
    t = playAll(normalize({ ...t, ...generateDraw(t), stage: 'running' }));
    expect(canGenerateNextStage(t)).toBe(true);

    const r1 = stagePools(t, 1).map((p) => poolStandings(t, p).map((row) => row.teamId));
    const phase2 = generateNextStage(t);
    expect(phase2.pools.map((p) => p.teamIds)).toEqual([
      [r1[0][0], r1[2][0], r1[1][1], r1[3][1]],
      [r1[1][0], r1[3][0], r1[2][1], r1[0][1]],
      [r1[0][2], r1[2][2], r1[1][3], r1[3][3]],
      [r1[1][2], r1[3][2], r1[0][3], r1[2][3]],
    ]);
    // La phase 2 commence après les 4 tours de 20 minutes de la phase 1, et ses éventuels barrages
    // (10 minutes chacun).
    const barrageSlots = new Set(t.matches.filter((m) => m.kind === 'tiebreak').map((m) => m.slot)).size;
    expect(Math.min(...phase2.matches.map((m) => m.start!))).toBe(9 * 60 + 4 * 20 + barrageSlots * 10);
    t = nextStage(t);

    const r2 = stagePools(t, 2).map((p) => poolStandings(t, p).map((row) => row.teamId));
    expect(generateNextStage(t).pools[0].teamIds).toEqual([r2[0][0], r2[0][1], r2[1][0], r2[1][1]]);
    t = nextStage(t);

    expect(t.matches.filter((m) => m.kind !== 'tiebreak')).toHaveLength(36);
    expect(t.stage).toBe('finished');
    expect(stagePools(t, 3).map((p) => p.name)).toEqual(['Places 1 à 4', 'Places 5 à 8', 'Places 9 à 12', 'Places 13 à 16']);
    const ranking = finalRanking(t);
    expect(new Set(ranking.map((r) => r.teamId)).size).toBe(16);
    expect(ranking[0].teamId).toBe(poolStandings(t, stagePools(t, 3)[0])[0].teamId);
    expect(ranking[8].teamId).toBe(poolStandings(t, stagePools(t, 3)[2])[0].teamId);
  });

  it('enchaîne les 3 phases à 12 paires', () => {
    let t = mixer(12);
    t = playAll(normalize({ ...t, ...generateDraw(t), stage: 'running' }));
    expect(t.pools).toHaveLength(3);
    const r1 = stagePools(t, 1).map((p) => poolStandings(t, p).map((row) => row.teamId));
    const phase2 = generateNextStage(t);
    expect(phase2.pools.map((p) => p.name)).toEqual(['Principale', 'Intermédiaire', 'Consolante']);
    expect(phase2.pools[0].teamIds).toEqual([r1[0][0], r1[1][0], r1[2][0], r1[0][1]]);
    t = nextStage(t);
    const r2 = stagePools(t, 2).map((p) => poolStandings(t, p).map((row) => row.teamId));
    // Montée / descente : le 4e de la poule 1 descend, le 1er de la poule 2 monte.
    expect(generateNextStage(t).pools[0].teamIds).toEqual([r2[0][0], r2[0][1], r2[0][2], r2[1][0]]);
    t = nextStage(t);
    expect(t.matches.filter((m) => m.kind !== 'tiebreak')).toHaveLength(27);
    expect(t.stage).toBe('finished');
    expect(new Set(finalRanking(t).map((r) => r.teamId)).size).toBe(12);
  });

  it('se joue uniquement à 12, 15 ou 16 paires', () => {
    expect(drawBlockers(mixer(14))).toEqual(['Le format « Poules brassées » (4 contre 4) se joue à 12, 15 ou 16 paires (14 inscrites).']);
    for (const n of [12, 15, 16]) expect(drawBlockers(mixer(n))).toEqual([]);
  });

  it('équilibre parfaitement une poule de 5 paires', () => {
    const rotations = mixerRotations(['p1', 'p2', 'p3', 'p4', 'p5']);
    const key = (x: string, y: string) => [x, y].sort().join('-');
    const partners = new Map<string, number>();
    const opponents = new Map<string, number>();
    const played = new Map<string, number>();
    for (const [sideA, sideB] of rotations) {
      for (const side of [sideA, sideB]) partners.set(key(side[0], side[1]), (partners.get(key(side[0], side[1])) ?? 0) + 1);
      for (const x of sideA) for (const y of sideB) opponents.set(key(x, y), (opponents.get(key(x, y)) ?? 0) + 1);
      for (const x of [...sideA, ...sideB]) played.set(x, (played.get(x) ?? 0) + 1);
    }
    expect(rotations).toHaveLength(5);
    // 10 couples de paires : chacun partenaire une fois et adversaire deux fois ; chaque paire joue 4 matchs.
    expect([partners.size, ...new Set(partners.values())]).toEqual([10, 1]);
    expect([opponents.size, ...new Set(opponents.values())]).toEqual([10, 2]);
    expect([...played.values()]).toEqual([4, 4, 4, 4, 4]);
  });

  it('indique le niveau de chaque paire à partir de la phase 2', () => {
    let t = mixer(16);
    t = playAll(normalize({ ...t, ...generateDraw(t), stage: 'running' }));
    expect(finalRanking(t).some((r) => r.level)).toBe(false);
    t = nextStage(t);
    const phase2 = finalRanking(t).map((r) => r.level);
    expect(phase2.slice(0, 8).every((l) => l?.name === 'Principale' && l.rank === 0)).toBe(true);
    expect(phase2.slice(8).every((l) => l?.name === 'Consolante' && l.rank === 1)).toBe(true);
    expect(withLevelStarts(finalRanking(t)).filter((r) => r.levelStart).map((r) => r.rank)).toEqual([1, 9]);
    t = nextStage(t);
    expect([...new Set(finalRanking(t).map((r) => r.level?.name))]).toEqual([
      'Places 1 à 4',
      'Places 5 à 8',
      'Places 9 à 12',
      'Places 13 à 16',
    ]);
  });

  it('enchaîne les 3 phases à 15 paires, en poules de 5', () => {
    let t = mixer(15);
    t = playAll(normalize({ ...t, ...generateDraw(t), stage: 'running' }));
    expect(t.pools.map((p) => p.teamIds.length)).toEqual([5, 5, 5]);
    expect(t.matches.filter((m) => m.stage === 1 && m.kind !== 'tiebreak')).toHaveLength(15);
    // Les 3 poules jouent en même temps sur les 3 terrains : 5 tours.
    expect(Math.max(...t.matches.filter((m) => m.kind !== 'tiebreak').map((m) => m.slot))).toBe(4);

    const r1 = stagePools(t, 1).map((p) => poolStandings(t, p).map((row) => row.teamId));
    const phase2 = generateNextStage(t);
    expect(phase2.pools.map((p) => p.name)).toEqual(['Principale', 'Intermédiaire', 'Consolante']);
    expect(phase2.pools[0].teamIds).toEqual([r1[0][0], r1[1][0], r1[2][0], r1[0][1], r1[1][1]]);
    t = nextStage(t);

    const r2 = stagePools(t, 2).map((p) => poolStandings(t, p).map((row) => row.teamId));
    expect(generateNextStage(t).pools.map((p) => p.teamIds)).toEqual([
      [r2[0][0], r2[0][1], r2[0][2], r2[0][3], r2[1][0]],
      [r2[0][4], r2[1][1], r2[1][2], r2[1][3], r2[2][0]],
      [r2[1][4], r2[2][1], r2[2][2], r2[2][3], r2[2][4]],
    ]);
    t = nextStage(t);
    expect(t.matches.filter((m) => m.kind !== 'tiebreak')).toHaveLength(45);
    expect(t.stage).toBe('finished');
    expect(stagePools(t, 3).map((p) => p.name)).toEqual(['Places 1 à 5', 'Places 6 à 10', 'Places 11 à 15']);
    expect(new Set(finalRanking(t).map((r) => r.teamId)).size).toBe(15);
  });

  describe('classement d’une poule', () => {
    const base = { phase: 'pool', status: 'done', slot: 0, court: 1, label: '', pool: '1', stage: 1 } as const;
    // Poule t1, t2, t3, t4 : (t1+t2) / (t3+t4), (t1+t3) / (t2+t4), (t1+t4) / (t2+t3).
    function pool(scores: [number, number][]): ReturnType<typeof poolStandings> {
      const sides = [
        [['t1', 't2'], ['t3', 't4']],
        [['t1', 't3'], ['t2', 't4']],
        [['t1', 't4'], ['t2', 't3']],
      ];
      const matches: Match[] = scores.map(([x, y], i) => ({
        ...base,
        id: `m${i + 1}`,
        round: i + 1,
        a: { teamId: sides[i][0][0], partnerId: sides[i][0][1] },
        b: { teamId: sides[i][1][0], partnerId: sides[i][1][1] },
        sets: [[x, y]],
      }));
      const t: Tournament = {
        ...tournament('mixer', 4),
        pools: [{ letter: '1', stage: 1, teamIds: ['t1', 't2', 't3', 't4'] }],
        matches,
      };
      return poolStandings(t, t.pools[0]);
    }

    it('classe chaque paire à l’écart cumulé de son camp', () => {
      // t1 : +9 +2 −4 = +7 ; t2 : +9 −2 +4 = +11 ; t3 : −9 +2 +4 = −3 ; t4 : −9 −2 −4 = −15.
      const rows = pool([[19, 10], [19, 17], [15, 19]]);
      expect(rows.map((r) => [r.teamId, r.pointsFor - r.pointsAgainst])).toEqual([
        ['t2', 11],
        ['t1', 7],
        ['t3', -3],
        ['t4', -15],
      ]);
    });

    function poolTournament(scores: [number, number][]): Tournament {
      const sides = [
        [['t1', 't2'], ['t3', 't4']],
        [['t1', 't3'], ['t2', 't4']],
        [['t1', 't4'], ['t2', 't3']],
      ];
      return {
        ...tournament('mixer', 4),
        stage: 'running',
        pools: [{ letter: '1', stage: 1, teamIds: ['t1', 't2', 't3', 't4'] }],
        matches: scores.map(([x, y], i) => ({
          ...base,
          id: `m${i + 1}`,
          round: i + 1,
          start: 9 * 60,
          a: { teamId: sides[i][0][0], partnerId: sides[i][0][1] },
          b: { teamId: sides[i][1][0], partnerId: sides[i][1][1] },
          sets: [[x, y]],
        })),
      };
    }

    it('crée un barrage en 6 points entre deux paires à égalité, qui bloque la phase suivante', () => {
      const t = normalize(poolTournament([[19, 10], [19, 17], [18, 20]]));
      const barrages = t.matches.filter((m) => m.kind === 'tiebreak');
      expect(barrages).toHaveLength(1);
      expect([barrages[0].a.teamId, barrages[0].b.teamId]).toEqual(['t1', 't2']);
      expect(barrages[0].a.partnerId).toBeUndefined();
      expect(matchRules(t, barrages[0])).toMatchObject({ setsToWin: 1, pointsPerSet: 6, cap: 6 });
      expect(barrages[0].slot).toBe(1);
      expect(canGenerateNextStage(t)).toBe(false);
      // Rappeler normalize ne crée pas de doublon.
      expect(normalize(t).matches.filter((m) => m.kind === 'tiebreak')).toHaveLength(1);
    });

    it('classe devant le vainqueur du barrage, sans toucher à l’écart', () => {
      let t = normalize(poolTournament([[19, 10], [19, 17], [18, 20]]));
      const barrage = t.matches.find((m) => m.kind === 'tiebreak')!;
      t = normalize({
        ...t,
        matches: t.matches.map((m) => (m.id === barrage.id ? { ...m, sets: [[4, 6]], status: 'done' } : m)),
      });
      const rows = poolStandings(t, t.pools[0]);
      expect(rows.slice(0, 2).map((r) => [r.teamId, r.pointsFor - r.pointsAgainst])).toEqual([
        ['t2', 9],
        ['t1', 9],
      ]);
      expect(canGenerateNextStage(t)).toBe(true);
    });

    it('ne crée pas de barrage sans égalité', () => {
      const t = normalize(poolTournament([[19, 10], [19, 17], [15, 19]]));
      expect(t.matches.some((m) => m.kind === 'tiebreak')).toBe(false);
    });

    it('deux paires à égalité d’écart le sont aussi sur leurs confrontations et leurs points', () => {
      // t1 et t2 jouent ensemble le 1er match et s'affrontent dans les deux autres :
      // à égalité d'écart, leurs confrontations s'annulent forcément (une victoire chacune).
      const rows = pool([[19, 10], [19, 17], [18, 20]]);
      const t1 = rows.find((r) => r.teamId === 't1')!;
      const t2 = rows.find((r) => r.teamId === 't2')!;
      expect(t1.pointsFor - t1.pointsAgainst).toBe(t2.pointsFor - t2.pointsAgainst);
      expect([t1.wins, t1.pointsFor]).toEqual([t2.wins, t2.pointsFor]);
      // Égalité parfaite : l'ordre de la poule (niveau ou classement de la phase précédente) est conservé.
      expect(rows.slice(0, 2).map((r) => r.teamId)).toEqual(['t1', 't2']);
    });
  });
});

describe('auto-arbitrage', () => {
  function run(format: Tournament['format'], teamCount: number, selfRefereeing = true): Tournament {
    const base = tournament(format, teamCount);
    let t: Tournament = {
      ...base,
      drawMode: format === 'mixer' ? 'level' : base.drawMode,
      settings: { ...DEFAULT_SETTINGS, courts: 3, maxTeams: teamCount, selfRefereeing },
      teams: base.teams.map((team, i) => ({ ...team, rating: 5 - i / 4 })),
    };
    t = normalize({ ...t, ...generateDraw(t), stage: 'running' });
    t = playAll(t);
    if (format === 'pools') t = playAll(normalize({ ...t, matches: [...t.matches, ...generateFinals(t)] }));
    if (format === 'mixer') {
      for (const _ of [2, 3]) {
        const next = generateNextStage(t);
        t = playAll(normalize({ ...t, pools: [...t.pools, ...next.pools], matches: [...t.matches, ...next.matches] }));
      }
    }
    return t;
  }

  function expectValidReferees(t: Tournament): number[] {
    const played = t.matches.filter((m) => m.slot >= 0 && !m.bye);
    for (const m of played) {
      expect(m.referee).toBeDefined();
      expect(matchTeams(m)).not.toContain(m.referee);
    }
    // Sur un même créneau, personne ne joue deux fois ni ne joue et arbitre à la fois.
    const slots = new Set(played.map((m) => m.slot));
    for (const slot of slots) {
      const people = played.filter((m) => m.slot === slot).flatMap((m) => [...matchTeams(m), m.referee]);
      expect(new Set(people).size).toBe(people.length);
    }
    return [...refereeCounts(t).values()];
  }

  // En 4 contre 4, les seules paires libres d'un tour sont celles de la poule au repos, et la
  // composition des poules suivantes dépend des résultats : l'écart vaut 1 le plus souvent,
  // jamais plus de 2.
  for (const n of [16, 15, 12]) {
    it(`répartit l’arbitrage en poules brassées à ${n} paires`, () => {
      const t = run('mixer', n);
      const counts = expectValidReferees(t);
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(2);
      expect(counts.reduce((a, b) => a + b, 0)).toBe(t.matches.length);
    });
  }

  // En tableau final, seules les équipes déjà éliminées peuvent arbitrer les derniers tours
  // (les autres jouent sur le même créneau) : un écart de 2 est inévitable sans connaître
  // les vainqueurs à l'avance.
  it('attribue les arbitres de la phase finale quand les qualifiés sont connus', () => {
    const counts = expectValidReferees(run('pools', 8));
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(2);
  });

  it('fonctionne en élimination directe', () => {
    const counts = expectValidReferees(run('elim', 8));
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(2);
  });

  it('répartit l’arbitrage équitablement en championnat', () => {
    const counts = expectValidReferees(run('league', 8));
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });

  it('limite les matchs simultanés au nombre d’équipes divisé par trois', () => {
    const t = run('league', 8);
    const perSlot = new Map<number, number>();
    t.matches.forEach((m) => perSlot.set(m.slot, (perSlot.get(m.slot) ?? 0) + 1));
    expect(Math.max(...perSlot.values())).toBe(2);
  });

  it('fait arbitrer chaque match de poule de 5 par la paire au repos de cette poule', () => {
    const t = run('mixer', 15);
    for (const m of t.matches.filter((x) => x.kind !== 'tiebreak')) {
      const pool = t.pools.find((p) => p.letter === m.pool && p.stage === m.stage)!;
      const resting = pool.teamIds.filter((id) => !matchTeams(m).includes(id));
      expect(resting).toEqual([m.referee]);
    }
  });

  it('n’attribue aucun arbitre si l’option est désactivée', () => {
    expect(run('mixer', 16, false).matches.some((m) => m.referee)).toBe(false);
  });
});
