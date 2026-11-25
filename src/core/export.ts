import ExcelJS from 'exceljs';
import { analysePlan, coverage, equipmentList, traceabilityMatrix } from './analysis';
import type { ProjectData, TestPlan } from './types';

const reqLabel = (d: ProjectData, id: string): string => d.requirements.find((r) => r.id === id)?.reqId ?? '?';
const eqLabel = (d: ProjectData, id: string): string => d.equipment.find((e) => e.id === id)?.name ?? '?';

function style(ws: ExcelJS.Worksheet): void {
  const header = ws.getRow(1);
  header.font = { bold: true };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E2F3' } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.columns.forEach((c) => {
    c.alignment = { vertical: 'top', wrapText: true };
  });
}

const tidList = (d: ProjectData, ids: string[]): string => ids.map((id) => d.testCases.find((t) => t.id === id)?.tid ?? '?').join(', ');

function addEquipmentSheets(wb: ExcelJS.Workbook, d: ProjectData, plan: TestPlan, now: Date): void {
  const list = equipmentList(d, plan, now);
  const eq = wb.addWorksheet('Required equipment');
  eq.columns = [
    { header: 'Equipment', width: 30 },
    { header: 'Kind', width: 17 },
    { header: 'Category', width: 20 },
    { header: 'Model', width: 20 },
    { header: 'Serial / asset', width: 16 },
    { header: 'Calibration due', width: 16 },
    { header: 'Status', width: 14 },
    { header: 'Problems', width: 30 },
    { header: 'Tests', width: 8 },
    { header: 'Used by tests', width: 36 },
    { header: 'Requirements', width: 36 },
    { header: 'Minutes in use', width: 14 },
  ];
  for (const u of list.items) {
    eq.addRow([
      u.equipment.name,
      u.equipment.kind === 'company' ? 'company-specific' : 'standard',
      u.equipment.category,
      u.equipment.model,
      u.equipment.serial,
      u.equipment.calibrationDue,
      u.equipment.status.replace(/_/g, ' '),
      u.problems.join('; '),
      u.testCaseIds.length,
      tidList(d, u.testCaseIds),
      u.requirementIds.map((r) => reqLabel(d, r)).join(', '),
      u.minutes,
    ]);
  }
  style(eq);

  const miss = wb.addWorksheet('Equipment to obtain');
  miss.columns = [
    { header: 'Needed equipment (not in catalogue)', width: 50 },
    { header: 'Used by tests', width: 36 },
    { header: 'Requirements', width: 36 },
  ];
  for (const m of list.missing) miss.addRow([m.need, tidList(d, m.testCaseIds), m.requirementIds.map((r) => reqLabel(d, r)).join(', ')]);
  style(miss);
}

/** Stand-alone Excel list of the equipment a plan needs. */
export async function buildEquipmentWorkbook(d: ProjectData, plan: TestPlan, now = new Date()): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.created = now;
  addEquipmentSheets(wb, d, plan, now);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

/** Excel test plan: plan sheet, test case detail, traceability matrix, coverage. */
export async function buildPlanWorkbook(d: ProjectData, plan: TestPlan, now = new Date()): Promise<Uint8Array> {
  const report = analysePlan(d, plan, now);
  const wb = new ExcelJS.Workbook();
  wb.created = now;

  const summary = wb.addWorksheet('Plan');
  summary.columns = [
    { header: 'Item', width: 28 },
    { header: 'Value', width: 70 },
  ];
  summary.addRows([
    ['Project', d.name],
    ['Plan', plan.name],
    ['Version', plan.version],
    ['Status', plan.status],
    ['Equipment scope', plan.equipmentScope],
    ['Scope', plan.scope],
    ['Generated', now.toISOString()],
    ['Test cases', report.tests.length],
    ['Estimated effort (min)', report.totalMinutes],
    ['Requirements covered', report.coveredRequirementIds.length],
    ['Verifiable requirements not covered', report.uncoveredInPlan.length],
    ['Notes', plan.notes],
  ]);
  style(summary);

  const tests = wb.addWorksheet('Test cases');
  tests.columns = [
    { header: 'Order', width: 7 },
    { header: 'Test ID', width: 10 },
    { header: 'Title', width: 36 },
    { header: 'Requirements', width: 28 },
    { header: 'Equipment', width: 30 },
    { header: 'Environment', width: 26 },
    { header: 'Preconditions', width: 30 },
    { header: 'Steps (action -> expected)', width: 60 },
    { header: 'Pass criteria', width: 30 },
    { header: 'Minutes', width: 9 },
    { header: 'Status', width: 10 },
    { header: 'Suspect', width: 10 },
  ];
  report.tests.forEach((t, i) => {
    tests.addRow([
      i + 1,
      t.tid,
      t.title,
      t.requirementIds.map((r) => reqLabel(d, r)).join(', '),
      t.equipmentIds.map((e) => eqLabel(d, e)).join(', '),
      t.environment,
      t.preconditions,
      t.steps.map((s, n) => `${n + 1}. ${s.action} -> ${s.expected}`).join('\n'),
      t.passCriteria,
      t.estimatedMinutes,
      t.status,
      t.suspect ? 'yes' : '',
    ]);
  });
  style(tests);

  addEquipmentSheets(wb, d, plan, now);

  const matrix = traceabilityMatrix({ ...d, testCases: report.tests });
  const tm = wb.addWorksheet('Traceability');
  tm.columns = [
    { header: 'Requirement', width: 16 },
    { header: 'Title', width: 36 },
    { header: 'Type', width: 14 },
    ...matrix.tests.map((t) => ({ header: t.tid, width: 9 })),
  ];
  for (const r of matrix.requirements) {
    tm.addRow([r.reqId, r.title, r.type, ...matrix.tests.map((t) => (matrix.links.has(`${r.id}|${t.id}`) ? 'X' : ''))]);
  }
  style(tm);

  const cov = wb.addWorksheet('Coverage gaps');
  cov.columns = [
    { header: 'Requirement', width: 16 },
    { header: 'Title', width: 40 },
    { header: 'Type', width: 14 },
    { header: 'Level', width: 12 },
  ];
  for (const r of report.uncoveredInPlan) cov.addRow([r.reqId, r.title, r.type, r.level]);
  style(cov);

  const iss = wb.addWorksheet('Issues');
  iss.columns = [
    { header: 'Severity', width: 10 },
    { header: 'Message', width: 100 },
  ];
  for (const i of report.issues) iss.addRow([i.severity, i.message]);
  style(iss);

  return new Uint8Array(await wb.xlsx.writeBuffer());
}

const esc = (s: unknown): string =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Printable HTML test plan, rendered to PDF by the Electron main process. */
export function buildPlanHtml(d: ProjectData, plan: TestPlan, now = new Date()): string {
  const report = analysePlan(d, plan, now);
  const cov = coverage(d);
  const rows = report.tests
    .map(
      (t, i) => `<section class="tc">
  <h3>${i + 1}. ${esc(t.tid)} ${esc(t.title)}${t.suspect ? ' <span class="warn">SUSPECT</span>' : ''}</h3>
  <p><b>Requirements:</b> ${esc(t.requirementIds.map((r) => reqLabel(d, r)).join(', ') || '-')}<br>
  <b>Equipment:</b> ${esc(t.equipmentIds.map((e) => eqLabel(d, e)).join(', ') || '-')}<br>
  <b>Environment:</b> ${esc(t.environment || '-')} &nbsp; <b>Effort:</b> ${t.estimatedMinutes} min</p>
  <p><b>Objective:</b> ${esc(t.objective)}</p>
  <p><b>Preconditions:</b> ${esc(t.preconditions || '-')}</p>
  <table><tr><th>#</th><th>Action</th><th>Expected</th></tr>
  ${t.steps.map((s, n) => `<tr><td>${n + 1}</td><td>${esc(s.action)}</td><td>${esc(s.expected)}</td></tr>`).join('')}
  </table>
  <p><b>Pass criteria:</b> ${esc(t.passCriteria)}</p>
</section>`,
    )
    .join('\n');
  const list = equipmentList(d, plan, now);
  const equipRows = list.items
    .map(
      (u) =>
        `<tr><td>${esc(u.equipment.name)}${u.equipment.model ? ` <span class="meta">${esc(u.equipment.model)}</span>` : ''}</td><td>${u.equipment.kind === 'company' ? 'company-specific' : 'standard'}</td><td>${esc(u.equipment.calibrationDue || '-')}</td><td>${esc(u.equipment.status.replace(/_/g, ' '))}</td><td>${esc(tidList(d, u.testCaseIds))}</td><td class="${u.problems.length ? 'warn' : ''}">${esc(u.problems.join('; '))}</td></tr>`,
    )
    .join('');
  const missingHtml = list.missing.length
    ? `<h3>Equipment to obtain (not in catalogue)</h3><table><tr><th>Needed</th><th>Tests</th></tr>${list.missing
        .map((m) => `<tr><td>${esc(m.need)}</td><td>${esc(tidList(d, m.testCaseIds))}</td></tr>`)
        .join('')}</table>`
    : '';
  const issues = report.issues.length
    ? `<ul>${report.issues.map((i) => `<li class="${i.severity}">${esc(i.severity)}: ${esc(i.message)}</li>`).join('')}</ul>`
    : '<p>No issues found.</p>';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(plan.name)}</title>
<style>
body{font-family:Segoe UI,Arial,sans-serif;font-size:11pt;color:#111;margin:24px}
h1{margin-bottom:0} h3{margin:0 0 4px} .meta{color:#555}
table{border-collapse:collapse;width:100%;margin:6px 0} th,td{border:1px solid #999;padding:4px 6px;text-align:left;vertical-align:top}
th{background:#e8eef8} .tc{page-break-inside:avoid;margin:16px 0;padding-top:8px;border-top:2px solid #333}
.warn,.warning{color:#b45309} .error{color:#b91c1c}
</style></head><body>
<h1>${esc(plan.name)}</h1>
<p class="meta">${esc(d.name)} | version ${plan.version} | ${esc(plan.status)} | equipment scope: ${esc(plan.equipmentScope)} | ${esc(now.toISOString().slice(0, 10))}</p>
<p>${esc(plan.scope)}</p>
<h2>Summary</h2>
<table>
<tr><th>Test cases</th><td>${report.tests.length}</td><th>Effort</th><td>${report.totalMinutes} min</td></tr>
<tr><th>Requirements covered by plan</th><td>${report.coveredRequirementIds.length}</td><th>Verifiable requirements not covered</th><td>${report.uncoveredInPlan.length}</td></tr>
<tr><th>Project coverage</th><td colspan="3">${cov.covered} of ${cov.verifiable} verifiable requirements (${cov.percent}%)</td></tr>
</table>
<h2>Required equipment</h2>
<table><tr><th>Equipment</th><th>Kind</th><th>Calibration due</th><th>Status</th><th>Tests</th><th>Problems</th></tr>
${equipRows}
</table>
${missingHtml}
<h2>Issues</h2>${issues}
<h2>Test cases</h2>
${rows}
</body></html>`;
}
