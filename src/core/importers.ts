import Papa from 'papaparse';
import ExcelJS from 'exceljs';
import {
  LEVELS,
  REQUIREMENT_TYPES,
  VERIFICATION_METHODS,
  type Level,
  type RequirementType,
  type StandardRef,
  type VerificationMethod,
} from './types';

/** A parsed table: first row of the source becomes headers. */
export interface RawTable {
  headers: string[];
  rows: string[][];
}

/**
 * Import sources are pluggable. CSV and Excel are built in; ReqIF, DOORS or
 * Jira exports can be added by implementing this interface and registering it.
 */
export interface ImportSource {
  id: string;
  label: string;
  extensions: string[];
  parse(input: Uint8Array, options?: { sheet?: string }): Promise<RawTable>;
}

export const csvSource: ImportSource = {
  id: 'csv',
  label: 'CSV',
  extensions: ['csv', 'txt'],
  async parse(input) {
    let text = new TextDecoder('utf-8').decode(input);
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM
    const result = Papa.parse<string[]>(text, { skipEmptyLines: 'greedy' });
    const all = result.data.map((r) => r.map((c) => String(c ?? '').trim()));
    return toTable(all);
  },
};

export const excelSource: ImportSource = {
  id: 'excel',
  label: 'Excel',
  extensions: ['xlsx'],
  async parse(input, options) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(input as unknown as ArrayBuffer);
    const ws = (options?.sheet ? wb.getWorksheet(options.sheet) : undefined) ?? wb.worksheets[0];
    if (!ws) return { headers: [], rows: [] };
    const all: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      const count = ws.columnCount;
      for (let c = 1; c <= count; c++) cells.push(cellText(row.getCell(c).value));
      all.push(cells);
    });
    return toTable(all);
  },
};

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if ('richText' in v) return v.richText.map((t) => t.text).join('').trim();
    if ('text' in v && typeof v.text === 'string') return v.text.trim();
    if ('result' in v && v.result !== undefined && v.result !== null) return String(v.result).trim();
    return '';
  }
  return String(v).trim();
}

function toTable(all: string[][]): RawTable {
  if (all.length === 0) return { headers: [], rows: [] };
  const [headers, ...rows] = all;
  return { headers, rows: rows.filter((r) => r.some((c) => c !== '')) };
}

export const importSources: ImportSource[] = [csvSource, excelSource];

export function sourceForFile(fileName: string): ImportSource | undefined {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return importSources.find((s) => s.extensions.includes(ext));
}

// ---------- Column mapping ----------

export const IMPORT_FIELDS = [
  'reqId',
  'title',
  'text',
  'type',
  'level',
  'verificationMethod',
  'standards',
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

/** field -> column index in the table, or undefined when unmapped. */
export type ColumnMapping = Partial<Record<ImportField, number>>;

const HEADER_SYNONYMS: Record<ImportField, string[]> = {
  reqId: ['id', 'req id', 'reqid', 'requirement id', 'identifier', 'key', 'ref', 'number'],
  title: ['title', 'name', 'summary', 'short description'],
  text: ['text', 'requirement', 'description', 'statement', 'requirement text', 'shall'],
  type: ['type', 'category', 'requirement type', 'class', 'kind'],
  level: ['level', 'v level', 'v-model level', 'layer', 'system level'],
  verificationMethod: ['verification method', 'verification', 'method', 'vm', 'verify by'],
  standards: ['standards', 'standard', 'regulation', 'regulations', 'compliance', 'reference', 'references'],
};

const norm = (s: string): string => s.toLowerCase().replace(/[_\-.]/g, ' ').replace(/\s+/g, ' ').trim();

export function guessMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const used = new Set<number>();
  const normalized = headers.map(norm);
  // exact synonym match first, then substring match
  for (const pass of ['exact', 'contains'] as const) {
    for (const field of IMPORT_FIELDS) {
      if (mapping[field] !== undefined) continue;
      const idx = normalized.findIndex((h, i) => {
        if (used.has(i) || !h) return false;
        return HEADER_SYNONYMS[field].some((syn) => (pass === 'exact' ? h === syn : h.includes(syn)));
      });
      if (idx >= 0) {
        mapping[field] = idx;
        used.add(idx);
      }
    }
  }
  return mapping;
}

// ---------- Value normalisation ----------

const TYPE_SYNONYMS: Record<string, RequirementType> = {
  func: 'functional',
  function: 'functional',
  nfr: 'other',
  'non functional': 'other',
  perf: 'performance',
  interfaces: 'interface',
  'interface requirement': 'interface',
  safe: 'safety',
  sec: 'security',
  env: 'environmental',
  environment: 'environmental',
  emc: 'environmental',
  legal: 'regulatory',
  regulation: 'regulatory',
  compliance: 'regulatory',
  standard: 'regulatory',
  ux: 'usability',
  'human factors': 'usability',
  availability: 'reliability',
  mtbf: 'reliability',
  maintenance: 'maintainability',
  serviceability: 'maintainability',
  design: 'constraint',
  'design constraint': 'constraint',
};

export function normaliseType(raw: string): RequirementType {
  const v = norm(raw);
  if ((REQUIREMENT_TYPES as readonly string[]).includes(v)) return v as RequirementType;
  return TYPE_SYNONYMS[v] ?? 'other';
}

const LEVEL_SYNONYMS: Record<string, Level> = {
  sys: 'system',
  'system level': 'system',
  sub: 'subsystem',
  'sub system': 'subsystem',
  assembly: 'subsystem',
  comp: 'component',
  unit: 'component',
  module: 'component',
  part: 'component',
};

export function normaliseLevel(raw: string): Level {
  const v = norm(raw);
  if ((LEVELS as readonly string[]).includes(v)) return v as Level;
  return LEVEL_SYNONYMS[v] ?? 'system';
}

const METHOD_SYNONYMS: Record<string, VerificationMethod> = {
  t: 'test',
  testing: 'test',
  i: 'inspection',
  review: 'inspection',
  a: 'analysis',
  simulation: 'analysis',
  d: 'demonstration',
  demo: 'demonstration',
};

export function normaliseMethod(raw: string): VerificationMethod {
  const v = norm(raw);
  if ((VERIFICATION_METHODS as readonly string[]).includes(v)) return v as VerificationMethod;
  return METHOD_SYNONYMS[v] ?? 'test';
}

/** "ISO 26262 (Part 6, 9.4); EU MDR 2017/745" -> StandardRef[] */
export function parseStandards(raw: string): StandardRef[] {
  return raw
    .split(/[;\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const m = /^(.*?)\s*\((.*)\)$/.exec(s);
      return m ? { standard: m[1].trim(), clause: m[2].trim() } : { standard: s };
    });
}

export interface RequirementDraft {
  reqId: string;
  title: string;
  text: string;
  type: RequirementType;
  level: Level;
  verificationMethod: VerificationMethod;
  standards: StandardRef[];
}

export interface DraftIssue {
  row: number; // 1-based data row
  message: string;
}

export function mapRows(
  table: RawTable,
  mapping: ColumnMapping,
): { drafts: RequirementDraft[]; issues: DraftIssue[] } {
  const drafts: RequirementDraft[] = [];
  const issues: DraftIssue[] = [];
  const seen = new Set<string>();
  const get = (row: string[], f: ImportField): string => {
    const i = mapping[f];
    return i === undefined ? '' : (row[i] ?? '').trim();
  };
  if (mapping.reqId === undefined) {
    return { drafts, issues: [{ row: 0, message: 'No column mapped to the requirement ID.' }] };
  }
  table.rows.forEach((row, idx) => {
    const n = idx + 1;
    const reqId = get(row, 'reqId');
    if (!reqId) {
      issues.push({ row: n, message: 'Missing requirement ID, row skipped.' });
      return;
    }
    if (seen.has(reqId)) {
      issues.push({ row: n, message: `Duplicate requirement ID "${reqId}", row skipped.` });
      return;
    }
    seen.add(reqId);
    const text = get(row, 'text');
    const title = get(row, 'title') || text.slice(0, 80);
    if (!text && !title) issues.push({ row: n, message: `Requirement "${reqId}" has no text.` });
    drafts.push({
      reqId,
      title,
      text,
      type: normaliseType(get(row, 'type')),
      level: normaliseLevel(get(row, 'level')),
      verificationMethod: normaliseMethod(get(row, 'verificationMethod')),
      standards: parseStandards(get(row, 'standards')),
    });
  });
  return { drafts, issues };
}
