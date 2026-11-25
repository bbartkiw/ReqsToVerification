import { randomUUID } from 'node:crypto';
import { suggestOrder } from './analysis';
import type { ProposedTest } from './generate';
import type { RequirementDraft } from './importers';
import type { Repository } from './repository';
import {
  emptyProject,
  type Equipment,
  type ProjectData,
  type Requirement,
  type StandardRef,
  type TestCase,
  type TestPlan,
} from './types';

export interface ImportResult {
  added: string[];
  updated: string[];
  unchanged: string[];
  /** Requirement IDs in the project that were absent from the import file. */
  missing: string[];
  /** Test cases newly flagged suspect because a linked requirement changed. */
  suspectedTests: { tid: string; reason: string }[];
}

const sameStandards = (a: StandardRef[], b: StandardRef[]): boolean =>
  JSON.stringify(a.map((s) => [s.standard, s.clause ?? ''])) === JSON.stringify(b.map((s) => [s.standard, s.clause ?? '']));

/**
 * Merge a requirements import into a project (pure; mutates `data`).
 * Matching is by external reqId. A change to title, text or verification
 * method bumps the version and flags linked tests as suspect.
 */
export function applyImport(data: ProjectData, drafts: RequirementDraft[], user: string, now: Date): ImportResult {
  const stamp = now.toISOString();
  const result: ImportResult = { added: [], updated: [], unchanged: [], missing: [], suspectedTests: [] };
  const seen = new Set<string>();

  for (const d of drafts) {
    seen.add(d.reqId);
    const existing = data.requirements.find((r) => r.reqId === d.reqId);
    if (!existing) {
      data.requirements.push({
        id: randomUUID(),
        ...d,
        status: 'active',
        createdBy: user,
        createdAt: stamp,
        updatedBy: user,
        updatedAt: stamp,
        version: 1,
      });
      result.added.push(d.reqId);
      continue;
    }
    const contentChanged =
      existing.title !== d.title || existing.text !== d.text || existing.verificationMethod !== d.verificationMethod;
    const metaChanged =
      existing.type !== d.type ||
      existing.level !== d.level ||
      !sameStandards(existing.standards, d.standards) ||
      existing.status !== 'active';
    if (!contentChanged && !metaChanged) {
      result.unchanged.push(d.reqId);
      continue;
    }
    const reasons: string[] = [];
    if (existing.text !== d.text) reasons.push('text');
    if (existing.title !== d.title) reasons.push('title');
    if (existing.verificationMethod !== d.verificationMethod) reasons.push('verification method');
    Object.assign(existing, d, { status: 'active' as const, updatedBy: user, updatedAt: stamp });
    if (contentChanged) {
      existing.version += 1;
      const reason = `Requirement ${existing.reqId} changed (${reasons.join(', ')}) in v${existing.version}`;
      for (const t of data.testCases) {
        if (t.status !== 'obsolete' && t.requirementIds.includes(existing.id)) {
          t.suspect = true;
          t.suspectReason = reason;
          t.updatedAt = stamp;
          result.suspectedTests.push({ tid: t.tid, reason });
        }
      }
    }
    result.updated.push(d.reqId);
  }
  result.missing = data.requirements.filter((r) => r.status === 'active' && !seen.has(r.reqId)).map((r) => r.reqId);
  data.auditLog.push({
    at: stamp,
    user,
    action: 'import',
    entity: 'requirements',
    entityId: '',
    detail: `added ${result.added.length}, updated ${result.updated.length}, unchanged ${result.unchanged.length}, missing ${result.missing.length}`,
  });
  return result;
}

type WithoutAudit<T> = Omit<T, 'createdBy' | 'createdAt' | 'updatedBy' | 'updatedAt' | 'version' | 'id'> & {
  id?: string;
};

/** Application service: all mutations go through here and are persisted + audited. */
export class ProjectService {
  private data: ProjectData = emptyProject();

  constructor(
    private readonly repo: Repository,
    private user = 'local-user',
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async init(): Promise<void> {
    this.data = await this.repo.load();
  }

  getData(): ProjectData {
    return this.data;
  }

  setUser(user: string): void {
    this.user = user;
  }

  private async commit(action: string, entity: string, entityId: string, detail: string): Promise<void> {
    this.data.auditLog.push({ at: this.clock().toISOString(), user: this.user, action, entity, entityId, detail });
    if (this.data.auditLog.length > 5000) this.data.auditLog.splice(0, this.data.auditLog.length - 5000);
    await this.repo.save(this.data);
  }

  private stampNew(): Pick<Requirement, 'createdBy' | 'createdAt' | 'updatedBy' | 'updatedAt' | 'version'> {
    const at = this.clock().toISOString();
    return { createdBy: this.user, createdAt: at, updatedBy: this.user, updatedAt: at, version: 1 };
  }

  async renameProject(name: string): Promise<void> {
    this.data.name = name.trim() || this.data.name;
    await this.commit('rename', 'project', '', this.data.name);
  }

  async newProject(name: string): Promise<void> {
    this.data = emptyProject(name || 'Untitled project');
    await this.commit('create', 'project', '', this.data.name);
  }

  async replaceProject(data: ProjectData): Promise<void> {
    this.data = data;
    await this.commit('open', 'project', '', data.name);
  }

  async importRequirements(drafts: RequirementDraft[]): Promise<ImportResult> {
    const result = applyImport(this.data, drafts, this.user, this.clock());
    await this.repo.save(this.data);
    return result;
  }

  // ----- Requirements -----

  async saveRequirement(input: WithoutAudit<Requirement>): Promise<Requirement> {
    const list = this.data.requirements;
    const dup = list.find((r) => r.reqId === input.reqId && r.id !== input.id);
    if (dup) throw new Error(`Requirement ID "${input.reqId}" already exists.`);
    const existing = input.id ? list.find((r) => r.id === input.id) : undefined;
    if (existing) {
      const changed =
        existing.text !== input.text || existing.title !== input.title || existing.verificationMethod !== input.verificationMethod;
      Object.assign(existing, input, { updatedBy: this.user, updatedAt: this.clock().toISOString() });
      if (changed) {
        existing.version += 1;
        this.flagSuspect(existing, `Requirement ${existing.reqId} edited (v${existing.version})`);
      }
      await this.commit('update', 'requirement', existing.id, existing.reqId);
      return existing;
    }
    const created: Requirement = { ...input, id: randomUUID(), ...this.stampNew() };
    list.push(created);
    await this.commit('create', 'requirement', created.id, created.reqId);
    return created;
  }

  private flagSuspect(req: Requirement, reason: string): void {
    for (const t of this.data.testCases) {
      if (t.status !== 'obsolete' && t.requirementIds.includes(req.id)) {
        t.suspect = true;
        t.suspectReason = reason;
      }
    }
  }

  async deleteRequirement(id: string): Promise<void> {
    const r = this.data.requirements.find((x) => x.id === id);
    this.data.requirements = this.data.requirements.filter((x) => x.id !== id);
    for (const t of this.data.testCases) t.requirementIds = t.requirementIds.filter((x) => x !== id);
    await this.commit('delete', 'requirement', id, r?.reqId ?? '');
  }

  // ----- Test cases -----

  private nextTid(): string {
    const max = this.data.testCases.reduce((m, t) => {
      const n = /^TC-(\d+)$/.exec(t.tid);
      return n ? Math.max(m, Number(n[1])) : m;
    }, 0);
    return `TC-${String(max + 1).padStart(3, '0')}`;
  }

  async saveTestCase(input: WithoutAudit<TestCase>): Promise<TestCase> {
    const list = this.data.testCases;
    const tid = input.tid?.trim() || this.nextTid();
    if (list.some((t) => t.tid === tid && t.id !== input.id)) throw new Error(`Test ID "${tid}" already exists.`);
    const existing = input.id ? list.find((t) => t.id === input.id) : undefined;
    if (existing) {
      Object.assign(existing, input, { tid, updatedBy: this.user, updatedAt: this.clock().toISOString() });
      existing.version += 1;
      await this.commit('update', 'testCase', existing.id, tid);
      return existing;
    }
    const created: TestCase = { ...input, tid, id: randomUUID(), ...this.stampNew() };
    list.push(created);
    await this.commit('create', 'testCase', created.id, tid);
    return created;
  }

  /** Create draft test cases from generator proposals (and optionally a plan holding them). */
  async createGenerated(proposals: ProposedTest[], planName?: string): Promise<{ tests: TestCase[]; plan?: TestPlan }> {
    const tests: TestCase[] = [];
    for (const p of proposals) {
      const created: TestCase = {
        id: randomUUID(),
        tid: this.nextTid(),
        title: p.title,
        objective: p.objective,
        preconditions: p.preconditions,
        steps: p.steps,
        passCriteria: p.passCriteria,
        environment: p.environment,
        requirementIds: p.requirementIds,
        equipmentIds: p.equipmentIds,
        status: 'draft',
        estimatedMinutes: p.estimatedMinutes,
        suspect: false,
        ...this.stampNew(),
      };
      this.data.testCases.push(created);
      tests.push(created);
    }
    let plan: TestPlan | undefined;
    if (planName?.trim() && tests.length) {
      plan = {
        id: randomUUID(),
        name: planName.trim(),
        scope: 'Generated from requirements',
        status: 'draft',
        equipmentScope: 'all',
        items: suggestOrder(this.data, tests.map((t) => t.id)).map((testCaseId, i) => ({ testCaseId, order: i + 1 })),
        notes: '',
        ...this.stampNew(),
      };
      this.data.plans.push(plan);
    }
    await this.commit('generate', 'testCase', '', `${tests.length} test case(s)${plan ? ` and plan "${plan.name}"` : ''}`);
    return { tests, plan };
  }

  /** Reviewer confirms the test is still valid for the changed requirement(s). */
  async clearSuspect(id: string): Promise<void> {
    const t = this.data.testCases.find((x) => x.id === id);
    if (!t) return;
    t.suspect = false;
    delete t.suspectReason;
    await this.commit('clear-suspect', 'testCase', id, t.tid);
  }

  async deleteTestCase(id: string): Promise<void> {
    const t = this.data.testCases.find((x) => x.id === id);
    this.data.testCases = this.data.testCases.filter((x) => x.id !== id);
    for (const p of this.data.plans) p.items = p.items.filter((i) => i.testCaseId !== id);
    await this.commit('delete', 'testCase', id, t?.tid ?? '');
  }

  // ----- Equipment -----

  async saveEquipment(input: WithoutAudit<Equipment>): Promise<Equipment> {
    const list = this.data.equipment;
    const existing = input.id ? list.find((e) => e.id === input.id) : undefined;
    if (existing) {
      Object.assign(existing, input, { updatedBy: this.user, updatedAt: this.clock().toISOString() });
      existing.version += 1;
      await this.commit('update', 'equipment', existing.id, existing.name);
      return existing;
    }
    const created: Equipment = { ...input, id: randomUUID(), ...this.stampNew() };
    list.push(created);
    await this.commit('create', 'equipment', created.id, created.name);
    return created;
  }

  async deleteEquipment(id: string): Promise<void> {
    const e = this.data.equipment.find((x) => x.id === id);
    this.data.equipment = this.data.equipment.filter((x) => x.id !== id);
    for (const t of this.data.testCases) t.equipmentIds = t.equipmentIds.filter((x) => x !== id);
    await this.commit('delete', 'equipment', id, e?.name ?? '');
  }

  // ----- Plans -----

  async savePlan(input: WithoutAudit<TestPlan>): Promise<TestPlan> {
    const list = this.data.plans;
    const items = input.items.map((it, i) => ({ testCaseId: it.testCaseId, order: i + 1 }));
    const existing = input.id ? list.find((p) => p.id === input.id) : undefined;
    if (existing) {
      Object.assign(existing, input, { items, updatedBy: this.user, updatedAt: this.clock().toISOString() });
      existing.version += 1;
      await this.commit('update', 'plan', existing.id, existing.name);
      return existing;
    }
    const created: TestPlan = { ...input, items, id: randomUUID(), ...this.stampNew() };
    list.push(created);
    await this.commit('create', 'plan', created.id, created.name);
    return created;
  }

  async deletePlan(id: string): Promise<void> {
    const p = this.data.plans.find((x) => x.id === id);
    this.data.plans = this.data.plans.filter((x) => x.id !== id);
    await this.commit('delete', 'plan', id, p?.name ?? '');
  }
}
