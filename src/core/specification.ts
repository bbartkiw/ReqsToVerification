import { analysePlan, equipmentList } from './analysis';
import type { ProjectData, Requirement, TestCase, TestPlan } from './types';

/** Format-neutral document model, rendered to PDF (via HTML) and Word. */
export type Block =
  | { kind: 'title'; text: string; subtitle?: string }
  | { kind: 'h1' | 'h2' | 'h3'; text: string }
  | { kind: 'p'; text: string }
  | { kind: 'note'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'kv'; rows: [string, string][] }
  | { kind: 'table'; header: string[]; rows: string[][]; widths?: number[] }
  | { kind: 'pagebreak' };

export interface SpecOptions {
  documentId: string;
  author: string;
  /** Add Actual result / Pass-Fail columns and a sign-off line to every test, so it doubles as an execution record. */
  includeResultColumns: boolean;
  includeTraceability: boolean;
  now: Date;
}

export const DEFAULT_SPEC_OPTIONS: Omit<SpecOptions, 'now'> = {
  documentId: '',
  author: '',
  includeResultColumns: true,
  includeTraceability: true,
};

const reqOf = (d: ProjectData, id: string): Requirement | undefined => d.requirements.find((r) => r.id === id);
const standardText = (r: Requirement): string =>
  r.standards.map((s) => (s.clause ? `${s.standard} (${s.clause})` : s.standard)).join('; ');
const hours = (min: number): string => `${Math.floor(min / 60)} h ${min % 60} min`;
const orDash = (s: string | undefined): string => (s && s.trim() ? s.trim() : '-');

export function buildSpecification(d: ProjectData, plan: TestPlan, opts: Partial<SpecOptions> = {}): Block[] {
  const o: SpecOptions = { ...DEFAULT_SPEC_OPTIONS, now: new Date(), ...opts };
  const report = analysePlan(d, plan, o.now);
  const equip = equipmentList(d, plan, o.now);
  const tests = report.tests;
  const date = o.now.toISOString().slice(0, 10);
  const docId = o.documentId.trim() || `TS-${plan.name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toUpperCase() || 'PLAN'}`;
  const blocks: Block[] = [];

  // ---- Title and control ----
  blocks.push({ kind: 'title', text: 'Test Specification', subtitle: `${d.name} - ${plan.name}` });
  blocks.push({
    kind: 'kv',
    rows: [
      ['Document ID', docId],
      ['Version', `${plan.version} (${plan.status})`],
      ['Date', date],
      ['Author', orDash(o.author)],
      ['Equipment focus', plan.equipmentScope === 'all' ? 'All equipment' : plan.equipmentScope === 'standard' ? 'Standard equipment only' : 'Company-specific equipment'],
    ],
  });
  blocks.push({ kind: 'h3', text: 'Review and approval' });
  blocks.push({
    kind: 'table',
    header: ['Role', 'Name', 'Signature', 'Date'],
    rows: [['Author', o.author, '', ''], ['Reviewer', '', '', ''], ['Approver', '', '', '']],
    widths: [20, 30, 30, 20],
  });

  const warnings = report.issues.filter((i) => i.severity !== 'info');
  if (warnings.length) {
    blocks.push({ kind: 'note', text: `Open points before release (${warnings.length}): ${warnings.map((w) => w.message).join(' ')}` });
  }
  blocks.push({ kind: 'pagebreak' });

  // ---- 1 Introduction ----
  blocks.push({ kind: 'h1', text: '1 Introduction' });
  blocks.push({ kind: 'h2', text: '1.1 Purpose' });
  blocks.push({
    kind: 'p',
    text: `This document specifies the verification tests for ${d.name}. It defines the equipment, set-up, procedures and pass criteria needed to show that the requirements below are met, and traces every test to the requirements it verifies.`,
  });
  blocks.push({ kind: 'h2', text: '1.2 Scope' });
  blocks.push({ kind: 'p', text: plan.scope.trim() || `Verification by test of ${report.coveredRequirementIds.length} requirement(s) using ${tests.length} test case(s).` });
  if (plan.notes.trim()) blocks.push({ kind: 'p', text: plan.notes.trim() });

  const reqs = report.coveredRequirementIds.map((id) => reqOf(d, id)).filter((r): r is Requirement => !!r);
  const byType = new Map<string, number>();
  for (const r of reqs) byType.set(r.type, (byType.get(r.type) ?? 0) + 1);
  blocks.push({ kind: 'h2', text: '1.3 Verification approach' });
  blocks.push({
    kind: 'p',
    text: `${reqs.length} requirement(s) are verified by test in this specification (${[...byType].map(([t, n]) => `${n} ${t}`).join(', ') || 'none'}). Total estimated effort: ${hours(report.totalMinutes)}. Requirements verified by inspection, analysis or demonstration are not part of this specification.`,
  });

  const stds = new Map<string, Set<string>>();
  for (const r of reqs) for (const s of r.standards) stds.set(s.standard, (stds.get(s.standard) ?? new Set()).add(s.clause ?? ''));
  blocks.push({ kind: 'h2', text: '1.4 Reference standards and regulations' });
  if (stds.size === 0) blocks.push({ kind: 'p', text: 'No standards or regulations are referenced by the requirements in scope.' });
  else
    blocks.push({
      kind: 'table',
      header: ['Standard / regulation', 'Clauses referenced'],
      rows: [...stds].sort((a, b) => a[0].localeCompare(b[0])).map(([s, c]) => [s, [...c].filter(Boolean).join('; ') || '-']),
      widths: [50, 50],
    });

  // ---- 2 Equipment ----
  blocks.push({ kind: 'h1', text: '2 Test equipment and environment' });
  blocks.push({ kind: 'h2', text: '2.1 Required equipment' });
  if (equip.items.length === 0) blocks.push({ kind: 'p', text: 'No equipment is linked to the tests in this plan.' });
  else
    blocks.push({
      kind: 'table',
      header: ['Equipment', 'Kind', 'Model / serial', 'Calibration due', 'Status', 'Used by'],
      rows: equip.items.map((u) => [
        u.equipment.name,
        u.equipment.kind === 'company' ? 'Company-specific' : 'Standard',
        [u.equipment.model, u.equipment.serial].filter(Boolean).join(' / ') || '-',
        u.equipment.calibrationDue || 'n/a',
        u.equipment.status.replace(/_/g, ' ') + (u.problems.length ? ` (${u.problems.join('; ')})` : ''),
        u.testCaseIds.map((id) => d.testCases.find((t) => t.id === id)?.tid ?? '?').join(', '),
      ]),
      widths: [22, 14, 16, 12, 18, 18],
    });
  if (equip.missing.length) {
    blocks.push({ kind: 'h2', text: '2.2 Equipment still to be obtained' });
    blocks.push({
      kind: 'table',
      header: ['Needed equipment', 'Used by'],
      rows: equip.missing.map((m) => [m.need, m.testCaseIds.map((id) => d.testCases.find((t) => t.id === id)?.tid ?? '?').join(', ')]),
      widths: [70, 30],
    });
  }
  const envs = [...new Set(tests.map((t) => t.environment.trim()).filter(Boolean))];
  blocks.push({ kind: 'h2', text: `${equip.missing.length ? '2.3' : '2.2'} Environmental conditions` });
  blocks.push({ kind: 'p', text: 'Unless a test states otherwise: ambient laboratory conditions (23 +/- 5 C, 45 to 75 % relative humidity) and the nominal supply voltage. Test-specific conditions:' });
  blocks.push({ kind: 'list', items: envs.length ? envs : ['None beyond ambient conditions.'] });

  // ---- 3 Summary ----
  blocks.push({ kind: 'h1', text: '3 Test case overview' });
  blocks.push({
    kind: 'table',
    header: ['Test ID', 'Title', 'Requirements', 'Equipment', 'Min'],
    rows: tests.map((t) => [
      t.tid,
      t.title,
      t.requirementIds.map((r) => reqOf(d, r)?.reqId ?? '?').join(', ') || '-',
      t.equipmentIds.map((e) => d.equipment.find((x) => x.id === e)?.name ?? '?').join(', ') || '-',
      String(t.estimatedMinutes),
    ]),
    widths: [10, 36, 20, 28, 6],
  });

  // ---- 4 Test case specifications ----
  blocks.push({ kind: 'pagebreak' });
  blocks.push({ kind: 'h1', text: '4 Test case specifications' });
  tests.forEach((t, i) => blocks.push(...testBlocks(d, t, i + 1, o)));

  // ---- 5 Traceability ----
  if (o.includeTraceability) {
    blocks.push({ kind: 'pagebreak' });
    blocks.push({ kind: 'h1', text: '5 Requirements traceability' });
    blocks.push({ kind: 'h2', text: '5.1 Requirements to test cases' });
    blocks.push({
      kind: 'table',
      header: ['Requirement', 'Title', 'Type', 'Test cases'],
      rows: reqs.map((r) => [
        r.reqId,
        r.title,
        r.type,
        tests.filter((t) => t.requirementIds.includes(r.id)).map((t) => t.tid).join(', '),
      ]),
      widths: [14, 46, 14, 26],
    });
    blocks.push({ kind: 'h2', text: '5.2 Verifiable requirements not covered by this specification' });
    if (report.uncoveredInPlan.length === 0) blocks.push({ kind: 'p', text: 'None. All requirements verified by test are covered.' });
    else
      blocks.push({
        kind: 'table',
        header: ['Requirement', 'Title', 'Type'],
        rows: report.uncoveredInPlan.map((r) => [r.reqId, r.title, r.type]),
        widths: [16, 64, 20],
      });
    const other = d.requirements.filter((r) => r.status === 'active' && r.verificationMethod !== 'test');
    if (other.length) {
      blocks.push({ kind: 'h2', text: '5.3 Requirements verified by other methods' });
      blocks.push({
        kind: 'table',
        header: ['Requirement', 'Title', 'Method'],
        rows: other.map((r) => [r.reqId, r.title, r.verificationMethod]),
        widths: [16, 64, 20],
      });
    }
  }
  return blocks;
}

function testBlocks(d: ProjectData, t: TestCase, n: number, o: SpecOptions): Block[] {
  const out: Block[] = [];
  out.push({ kind: 'h2', text: `4.${n} ${t.tid} ${t.title}` });
  if (t.suspect) out.push({ kind: 'note', text: `Suspect: ${t.suspectReason ?? 'a linked requirement changed'}. Review before use.` });
  out.push({
    kind: 'kv',
    rows: [
      ['Objective', orDash(t.objective)],
      [
        'Requirements',
        t.requirementIds
          .map((id) => reqOf(d, id))
          .filter((r): r is Requirement => !!r)
          .map((r) => `${r.reqId}: ${r.text || r.title}${r.standards.length ? ` [${standardText(r)}]` : ''}`)
          .join('\n') || '-',
      ],
      ['Equipment', [...t.equipmentIds.map((e) => d.equipment.find((x) => x.id === e)?.name ?? '?'), ...(t.missingEquipment ?? []).map((m) => `${m} (to be obtained)`)].join(', ') || '-'],
      ['Environment', orDash(t.environment)],
      ['Preconditions', orDash(t.preconditions)],
      ['Estimated time', `${t.estimatedMinutes} min`],
    ],
  });
  const header = ['Step', 'Action', 'Expected result'];
  const widths = o.includeResultColumns ? [6, 38, 30, 18, 8] : [8, 52, 40];
  if (o.includeResultColumns) header.push('Actual result', 'P/F');
  out.push({
    kind: 'table',
    header,
    rows: t.steps.map((s, i) => [String(i + 1), s.action, s.expected, ...(o.includeResultColumns ? ['', ''] : [])]),
    widths,
  });
  out.push({ kind: 'p', text: `Pass criteria: ${orDash(t.passCriteria)}` });
  if (o.includeResultColumns) {
    out.push({
      kind: 'table',
      header: ['Result', 'Tester', 'Date', 'Item serial no.', 'Remarks'],
      rows: [['Pass / Fail', '', '', '', '']],
      widths: [16, 22, 16, 20, 26],
    });
  }
  return out;
}
