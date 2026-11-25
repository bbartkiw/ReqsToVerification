import type {
  Equipment,
  EquipmentScope,
  ProjectData,
  Requirement,
  TestCase,
  TestPlan,
} from './types';

export interface CoverageBucket {
  key: string;
  total: number;
  covered: number;
}

export interface CoverageReport {
  /** Active requirements whose verification method is "test". */
  verifiable: number;
  covered: number;
  percent: number;
  uncovered: Requirement[];
  /** Active requirements verified by inspection/analysis/demonstration. */
  nonTestMethod: number;
  orphanTests: TestCase[];
  suspectTests: TestCase[];
  byType: CoverageBucket[];
  byLevel: CoverageBucket[];
  byStandard: CoverageBucket[];
}

const liveTests = (d: ProjectData): TestCase[] => d.testCases.filter((t) => t.status !== 'obsolete');

export function coveredRequirementIds(tests: TestCase[]): Set<string> {
  const s = new Set<string>();
  for (const t of tests) for (const r of t.requirementIds) s.add(r);
  return s;
}

function bucketize(reqs: Requirement[], covered: Set<string>, keysOf: (r: Requirement) => string[]): CoverageBucket[] {
  const map = new Map<string, CoverageBucket>();
  for (const r of reqs) {
    for (const key of keysOf(r)) {
      const b = map.get(key) ?? { key, total: 0, covered: 0 };
      b.total++;
      if (covered.has(r.id)) b.covered++;
      map.set(key, b);
    }
  }
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export function coverage(d: ProjectData): CoverageReport {
  const tests = liveTests(d);
  const covered = coveredRequirementIds(tests);
  const active = d.requirements.filter((r) => r.status === 'active');
  const verifiable = active.filter((r) => r.verificationMethod === 'test');
  const uncovered = verifiable.filter((r) => !covered.has(r.id));
  const coveredCount = verifiable.length - uncovered.length;
  return {
    verifiable: verifiable.length,
    covered: coveredCount,
    percent: verifiable.length === 0 ? 100 : Math.round((coveredCount / verifiable.length) * 1000) / 10,
    uncovered,
    nonTestMethod: active.length - verifiable.length,
    orphanTests: tests.filter((t) => t.requirementIds.length === 0),
    suspectTests: tests.filter((t) => t.suspect),
    byType: bucketize(verifiable, covered, (r) => [r.type]),
    byLevel: bucketize(verifiable, covered, (r) => [r.level]),
    byStandard: bucketize(verifiable, covered, (r) =>
      r.standards.length ? r.standards.map((s) => s.standard) : ['(no standard)'],
    ),
  };
}

export interface MatrixData {
  requirements: Requirement[];
  tests: TestCase[];
  /** `${requirementId}|${testId}` for each link */
  links: Set<string>;
}

export function traceabilityMatrix(d: ProjectData): MatrixData {
  const tests = liveTests(d);
  const links = new Set<string>();
  for (const t of tests) for (const r of t.requirementIds) links.add(`${r}|${t.id}`);
  return { requirements: d.requirements.filter((r) => r.status === 'active'), tests, links };
}

// ---------- Equipment & plans ----------

export function matchesScope(test: TestCase, equipment: Equipment[], scope: EquipmentScope): boolean {
  if (scope === 'all') return true;
  const used = test.equipmentIds
    .map((id) => equipment.find((e) => e.id === id))
    .filter((e): e is Equipment => !!e);
  if (scope === 'standard') return used.every((e) => e.kind === 'standard');
  return used.some((e) => e.kind === 'company');
}

export function selectTestsByScope(d: ProjectData, scope: EquipmentScope): TestCase[] {
  return liveTests(d).filter((t) => matchesScope(t, d.equipment, scope));
}

export type Severity = 'error' | 'warning' | 'info';

export interface PlanIssue {
  severity: Severity;
  testCaseId?: string;
  equipmentId?: string;
  message: string;
}

export interface EquipmentUsage {
  equipment: Equipment;
  testCaseIds: string[];
}

export type CalibrationState = 'none' | 'ok' | 'due-soon' | 'expired';

export interface RequiredEquipment {
  equipment: Equipment;
  testCaseIds: string[];
  /** Requirements that depend on this equipment via the plan's tests. */
  requirementIds: string[];
  minutes: number;
  calibration: CalibrationState;
  /** Why this item may not be usable, empty when fine. */
  problems: string[];
}

export interface MissingEquipment {
  need: string;
  testCaseIds: string[];
  requirementIds: string[];
}

export interface EquipmentList {
  /** Catalogue items needed by the plan: standard first, then company-specific. */
  items: RequiredEquipment[];
  /** Needs recorded on tests that have no catalogue item yet. */
  missing: MissingEquipment[];
}

/** Consolidated list of the equipment a plan needs, with where and why. */
export function equipmentList(d: ProjectData, plan: TestPlan, now: Date = new Date()): EquipmentList {
  const tests = plan.items
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((i) => d.testCases.find((t) => t.id === i.testCaseId))
    .filter((t): t is TestCase => !!t);
  const items = new Map<string, RequiredEquipment>();
  const missing = new Map<string, MissingEquipment>();
  for (const t of tests) {
    for (const eid of t.equipmentIds) {
      const e = d.equipment.find((x) => x.id === eid);
      if (!e) continue;
      const cal = calibrationState(e, now);
      const it = items.get(eid) ?? {
        equipment: e,
        testCaseIds: [],
        requirementIds: [],
        minutes: 0,
        calibration: cal,
        problems: [
          ...(cal === 'expired' ? [`calibration expired ${e.calibrationDue}`] : cal === 'due-soon' ? [`calibration due ${e.calibrationDue}`] : []),
          ...(e.status === 'in_repair' ? ['in repair'] : e.status === 'to_be_built' ? ['still to be built'] : e.status === 'to_procure' ? ['still to be procured'] : []),
        ],
      };
      it.testCaseIds.push(t.id);
      it.minutes += t.estimatedMinutes || 0;
      for (const r of t.requirementIds) if (!it.requirementIds.includes(r)) it.requirementIds.push(r);
      items.set(eid, it);
    }
    for (const need of t.missingEquipment ?? []) {
      const key = need.trim().toLowerCase();
      if (!key) continue;
      const m = missing.get(key) ?? { need: need.trim(), testCaseIds: [], requirementIds: [] };
      m.testCaseIds.push(t.id);
      for (const r of t.requirementIds) if (!m.requirementIds.includes(r)) m.requirementIds.push(r);
      missing.set(key, m);
    }
  }
  const rank = (r: RequiredEquipment): number => (r.equipment.kind === 'standard' ? 0 : 1);
  return {
    items: [...items.values()].sort((a, b) => rank(a) - rank(b) || a.equipment.name.localeCompare(b.equipment.name)),
    missing: [...missing.values()].sort((a, b) => a.need.localeCompare(b.need)),
  };
}

export interface PlanReport {
  tests: TestCase[];
  totalMinutes: number;
  equipmentUsage: EquipmentUsage[];
  issues: PlanIssue[];
  coveredRequirementIds: string[];
  /** Verifiable requirements not covered by this plan. */
  uncoveredInPlan: Requirement[];
}

const DAY = 86_400_000;

export function calibrationState(e: Equipment, now: Date, warnDays = 30): CalibrationState {
  if (!e.calibrationDue) return 'none';
  const due = Date.parse(e.calibrationDue);
  if (Number.isNaN(due)) return 'none';
  // The due date is inclusive: calibration is valid through the end of that day.
  const validUntil = due + DAY;
  if (now.getTime() >= validUntil) return 'expired';
  return validUntil - now.getTime() <= warnDays * DAY ? 'due-soon' : 'ok';
}

export function analysePlan(d: ProjectData, plan: TestPlan, now: Date = new Date()): PlanReport {
  const ordered = [...plan.items].sort((a, b) => a.order - b.order);
  const tests: TestCase[] = [];
  const issues: PlanIssue[] = [];
  for (const item of ordered) {
    const t = d.testCases.find((x) => x.id === item.testCaseId);
    if (!t) {
      issues.push({ severity: 'error', testCaseId: item.testCaseId, message: 'Test case no longer exists.' });
      continue;
    }
    tests.push(t);
    if (t.status === 'obsolete') issues.push({ severity: 'error', testCaseId: t.id, message: `${t.tid} is obsolete.` });
    if (t.status === 'draft') issues.push({ severity: 'warning', testCaseId: t.id, message: `${t.tid} is still a draft.` });
    if (t.suspect)
      issues.push({ severity: 'warning', testCaseId: t.id, message: `${t.tid} is suspect: ${t.suspectReason ?? 'linked requirement changed'}.` });
    if (t.requirementIds.length === 0)
      issues.push({ severity: 'info', testCaseId: t.id, message: `${t.tid} is not linked to any requirement.` });
    if (!matchesScope(t, d.equipment, plan.equipmentScope))
      issues.push({
        severity: 'error',
        testCaseId: t.id,
        message: `${t.tid} does not match the plan equipment scope "${plan.equipmentScope}".`,
      });
  }

  const usageMap = new Map<string, EquipmentUsage>();
  for (const t of tests) {
    for (const eid of t.equipmentIds) {
      const e = d.equipment.find((x) => x.id === eid);
      if (!e) {
        issues.push({ severity: 'error', testCaseId: t.id, message: `${t.tid} references missing equipment.` });
        continue;
      }
      const u = usageMap.get(eid) ?? { equipment: e, testCaseIds: [] };
      u.testCaseIds.push(t.id);
      usageMap.set(eid, u);
    }
  }
  for (const { equipment: e } of usageMap.values()) {
    const cal = calibrationState(e, now);
    if (cal === 'expired')
      issues.push({ severity: 'error', equipmentId: e.id, message: `${e.name}: calibration expired on ${e.calibrationDue}.` });
    else if (cal === 'due-soon')
      issues.push({ severity: 'warning', equipmentId: e.id, message: `${e.name}: calibration due on ${e.calibrationDue}.` });
    if (e.status === 'in_repair')
      issues.push({ severity: 'error', equipmentId: e.id, message: `${e.name} is in repair.` });
    if (e.status === 'to_be_built')
      issues.push({ severity: 'warning', equipmentId: e.id, message: `${e.name} has still to be built.` });
    if (e.status === 'to_procure')
      issues.push({ severity: 'warning', equipmentId: e.id, message: `${e.name} has still to be procured.` });
  }

  for (const m of equipmentList(d, plan, now).missing) {
    issues.push({
      severity: 'warning',
      message: `Equipment not in catalogue: ${m.need} (needed by ${m.testCaseIds.map((id) => d.testCases.find((t) => t.id === id)?.tid ?? '?').join(', ')}).`,
    });
  }

  const covered = coveredRequirementIds(tests);
  const verifiable = d.requirements.filter((r) => r.status === 'active' && r.verificationMethod === 'test');
  return {
    tests,
    totalMinutes: tests.reduce((s, t) => s + (t.estimatedMinutes || 0), 0),
    equipmentUsage: [...usageMap.values()].sort((a, b) => a.equipment.name.localeCompare(b.equipment.name)),
    issues,
    coveredRequirementIds: [...covered],
    uncoveredInPlan: verifiable.filter((r) => !covered.has(r.id)),
  };
}

/**
 * Suggest an order that groups tests sharing equipment, so rigs are set up
 * and torn down as few times as possible. Tests without equipment go first.
 */
export function suggestOrder(d: ProjectData, testCaseIds: string[]): string[] {
  const tests = testCaseIds
    .map((id) => d.testCases.find((t) => t.id === id))
    .filter((t): t is TestCase => !!t);
  const freq = new Map<string, number>();
  for (const t of tests) for (const e of t.equipmentIds) freq.set(e, (freq.get(e) ?? 0) + 1);
  const keyOf = (t: TestCase): string =>
    [...t.equipmentIds].sort((a, b) => (freq.get(b)! - freq.get(a)!) || a.localeCompare(b)).join(',');
  return tests
    .map((t, i) => ({ t, i, k: keyOf(t) }))
    .sort((a, b) => (a.k === b.k ? a.i - b.i : a.k === '' ? -1 : b.k === '' ? 1 : a.k.localeCompare(b.k)))
    .map((x) => x.t.id);
}
