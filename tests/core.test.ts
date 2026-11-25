import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { analysePlan, calibrationState, coverage, selectTestsByScope, suggestOrder } from '../src/core/analysis';
import { buildPlanHtml, buildPlanWorkbook } from '../src/core/export';
import { csvSource, excelSource, guessMapping, mapRows, parseStandards } from '../src/core/importers';
import { MemoryRepository } from '../src/core/repository';
import { ProjectService } from '../src/core/service';

const csv = readFileSync('samples/requirements.csv');

async function loadSample() {
  const svc = new ProjectService(new MemoryRepository(), 'tester', () => new Date('2026-01-01T00:00:00Z'));
  await svc.init();
  const table = await csvSource.parse(csv);
  const { drafts, issues } = mapRows(table, guessMapping(table.headers));
  expect(issues).toEqual([]);
  await svc.importRequirements(drafts);
  return svc;
}

const baseTest = {
  objective: 'o',
  preconditions: '',
  steps: [{ action: 'a', expected: 'e' }],
  passCriteria: 'p',
  environment: '',
  requirementIds: [] as string[],
  equipmentIds: [] as string[],
  status: 'ready' as const,
  estimatedMinutes: 10,
  suspect: false,
};

describe('import', () => {
  it('guesses the column mapping and normalises values', async () => {
    const table = await csvSource.parse(csv);
    const m = guessMapping(table.headers);
    expect(m).toMatchObject({ reqId: 0, title: 1, text: 2, type: 3, level: 4, verificationMethod: 5, standards: 6 });
    const { drafts } = mapRows(table, m);
    expect(drafts).toHaveLength(9);
    expect(drafts[3].type).toBe('safety');
    expect(drafts[5].verificationMethod).toBe('inspection');
    expect(drafts[6].level).toBe('subsystem');
    expect(drafts[3].standards).toHaveLength(2);
  });

  it('parses standards with clauses', () => {
    expect(parseStandards('ISO 26262 (Part 6); EU MDR')).toEqual([
      { standard: 'ISO 26262', clause: 'Part 6' },
      { standard: 'EU MDR' },
    ]);
  });

  it('reads Excel files', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Reqs');
    ws.addRow(['ID', 'Requirement', 'Type']);
    ws.addRow(['R1', 'Shall do x', 'Functional']);
    const buf = new Uint8Array(await wb.xlsx.writeBuffer());
    const table = await excelSource.parse(buf);
    const { drafts } = mapRows(table, guessMapping(table.headers));
    expect(drafts).toMatchObject([{ reqId: 'R1', text: 'Shall do x', type: 'functional' }]);
  });

  it('reports duplicates and missing ids', async () => {
    const { drafts, issues } = mapRows(
      { headers: ['ID', 'Text'], rows: [['A', 't'], ['A', 't2'], ['', 'x']] },
      { reqId: 0, text: 1 },
    );
    expect(drafts).toHaveLength(1);
    expect(issues).toHaveLength(2);
  });
});

describe('re-import and suspect links', () => {
  it('flags linked tests suspect when requirement text changes', async () => {
    const svc = await loadSample();
    const req = svc.getData().requirements.find((r) => r.reqId === 'SYS-001')!;
    const tc = await svc.saveTestCase({ ...baseTest, tid: '', title: 't', requirementIds: [req.id] });
    expect(tc.tid).toBe('TC-001');

    const table = await csvSource.parse(csv);
    const { drafts } = mapRows(table, guessMapping(table.headers));
    drafts[0].text = 'The device shall be operational within 3 s.';
    const res = await svc.importRequirements(drafts);
    expect(res.updated).toEqual(['SYS-001']);
    expect(res.unchanged).toHaveLength(8);
    expect(res.suspectedTests[0].tid).toBe('TC-001');
    expect(svc.getData().testCases[0].suspect).toBe(true);
    expect(svc.getData().requirements.find((r) => r.reqId === 'SYS-001')!.version).toBe(2);
    await svc.clearSuspect(tc.id);
    expect(svc.getData().testCases[0].suspect).toBe(false);
  });
});

describe('coverage, many-to-many and plans', () => {
  it('computes coverage with one test covering many requirements', async () => {
    const svc = await loadSample();
    const d = svc.getData();
    const ids = ['SYS-001', 'SYS-002'].map((k) => d.requirements.find((r) => r.reqId === k)!.id);
    await svc.saveTestCase({ ...baseTest, tid: '', title: 'combined', requirementIds: ids });
    await svc.saveTestCase({ ...baseTest, tid: '', title: 'second for SYS-001', requirementIds: [ids[0]] });
    const cov = coverage(svc.getData());
    expect(cov.verifiable).toBe(6); // inspection/analysis/demonstration excluded
    expect(cov.covered).toBe(2);
    expect(cov.uncovered).toHaveLength(4);
    expect(cov.nonTestMethod).toBe(3);
  });

  it('filters by equipment scope and checks calibration', async () => {
    const svc = await loadSample();
    const scope = await svc.saveEquipment({
      name: 'Scope', kind: 'standard', category: 'Meas', model: '', serial: '', calibrationDue: '2025-12-31', status: 'available', notes: '',
    });
    const rig = await svc.saveEquipment({
      name: 'Thermal rig', kind: 'company', category: 'Env', model: '', serial: '', calibrationDue: '', status: 'to_be_built', notes: '',
    });
    const a = await svc.saveTestCase({ ...baseTest, tid: '', title: 'std', equipmentIds: [scope.id] });
    const b = await svc.saveTestCase({ ...baseTest, tid: '', title: 'company', equipmentIds: [scope.id, rig.id] });
    const c = await svc.saveTestCase({ ...baseTest, tid: '', title: 'none' });
    const d = svc.getData();
    expect(selectTestsByScope(d, 'standard').map((t) => t.id).sort()).toEqual([a.id, c.id].sort());
    expect(selectTestsByScope(d, 'company').map((t) => t.id)).toEqual([b.id]);

    const plan = await svc.savePlan({
      name: 'P', scope: '', status: 'draft', equipmentScope: 'standard', notes: '',
      items: [{ testCaseId: a.id, order: 1 }, { testCaseId: b.id, order: 2 }],
    });
    const report = analysePlan(d, plan, new Date('2026-01-10T00:00:00Z'));
    const msgs = report.issues.map((i) => i.message).join('|');
    expect(msgs).toContain('calibration expired');
    expect(msgs).toContain('has still to be built');
    expect(msgs).toContain('does not match the plan equipment scope');
    expect(report.totalMinutes).toBe(20);

    expect(calibrationState(d.equipment[0], new Date('2025-12-31T12:00:00Z'))).toBe('due-soon');
    expect(suggestOrder(d, [b.id, a.id, c.id])[0]).toBe(c.id);

    const xlsx = await buildPlanWorkbook(d, plan, new Date('2026-01-10T00:00:00Z'));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toContain('Traceability');
    expect(buildPlanHtml(d, plan)).toContain('Thermal rig');
  });
});
