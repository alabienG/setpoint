import { LEVELS, Level, Player } from '../core/models';

export interface ImportedTeam {
  name: string;
  level: Level;
  players?: Player[];
  rating?: number;
}

/**
 * Niveau associé à la catégorie habituelle d'un joueur, de 1 (débutant) à 5 (confirmé).
 * Une catégorie inconnue compte pour 3.
 */
export const CATEGORY_RATINGS: Record<string, number> = {
  departementale: 5,
  'masculine mouv': 4,
  'mixte mouv': 3,
  'feminine fsgt': 3,
  'mixte fun': 2,
};
const DEFAULT_RATING = 3;

function normalizeKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
}

export function categoryRating(category: string): number {
  return CATEGORY_RATINGS[normalizeKey(category)] ?? DEFAULT_RATING;
}

export function levelFromRating(rating: number): Level {
  return rating >= 4 ? 'Avancé' : rating >= 3 ? 'Intermédiaire' : 'Loisir';
}

/** Découpe un CSV en cellules (gère les guillemets et les séparateurs , ; ou tabulation). */
export function parseCsv(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const separator = [';', '\t', ','].reduce((best, sep) =>
    firstLine.split(sep).length > firstLine.split(best).length ? sep : best,
  );
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === separator) {
      row.push(cell.trim());
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell.trim());
    rows.push(row);
  }
  return rows;
}

/**
 * Feuille d'inscription en binômes : des blocs « Equipe N » suivis de lignes « n°, Prénom, Catégorie ».
 * Chaque binôme devient une équipe ; son niveau est la moyenne de celui de ses joueurs.
 */
function parsePairsSheet(rows: string[][]): ImportedTeam[] {
  const teams: { label: string; players: Player[] }[] = [];
  for (const row of rows) {
    const header = row[1]?.match(/^(?:é|e)quipe\s*(\d+)$/i);
    if (header) {
      teams.push({ label: `Équipe ${header[1]}`, players: [] });
      continue;
    }
    const current = teams.at(-1);
    if (current && /^\d+$/.test(row[0] ?? '') && (row[1] || row[2]) && current.players.length < 2) {
      current.players.push({ name: row[1] ?? '', category: row[2] ?? '' });
    }
  }
  return teams
    .filter((t) => t.players.length > 0)
    .map((t) => {
      const named = t.players.map((p) => p.name).filter(Boolean);
      const rating = Math.round((t.players.reduce((sum, p) => sum + categoryRating(p.category), 0) / t.players.length) * 2) / 2;
      return {
        name: named.length === t.players.length ? named.join(' / ') : t.label,
        players: t.players,
        rating,
        level: levelFromRating(rating),
      };
    });
}

/** Liste simple : une équipe par ligne, « Nom » ou « Nom;Niveau ». */
function parseTeamList(rows: string[][]): ImportedTeam[] {
  return rows
    .filter(([name]) => !!name && !/^(nom|name|équipe|equipe)$/i.test(name))
    .map(([name, level]) => ({
      name,
      level: LEVELS.find((l) => l.toLowerCase() === level?.toLowerCase()) ?? 'Intermédiaire',
    }));
}

export function parseTeams(text: string): ImportedTeam[] {
  const rows = parseCsv(text);
  const isPairsSheet = rows.some((row) => /^(?:é|e)quipe\s*\d+$/i.test(row[1] ?? ''));
  return isPairsSheet ? parsePairsSheet(rows) : parseTeamList(rows);
}

/** URL d'export CSV d'une Google Sheet partagée par lien (onglet indiqué par `gid`). */
export function googleSheetCsvUrl(link: string): string | null {
  const id = link.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)?.[1];
  if (!id) return null;
  const gid = link.match(/[#&?]gid=(\d+)/)?.[1] ?? '0';
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
}
