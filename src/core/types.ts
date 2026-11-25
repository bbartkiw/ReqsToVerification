// Domain model. Every record carries audit fields so a multi-user backend
// can be added later without reshaping the data.

export const REQUIREMENT_TYPES = [
  'functional',
  'performance',
  'interface',
  'safety',
  'security',
  'environmental',
  'regulatory',
  'usability',
  'reliability',
  'maintainability',
  'constraint',
  'other',
] as const;
export type RequirementType = (typeof REQUIREMENT_TYPES)[number];

/** Non-functional types are everything except functional (and other). */
export const isNonFunctional = (t: RequirementType): boolean => t !== 'functional' && t !== 'other';

/** V-model levels, verification side. Validation levels can be appended later. */
export const LEVELS = ['system', 'subsystem', 'component'] as const;
export type Level = (typeof LEVELS)[number];

export const VERIFICATION_METHODS = ['test', 'inspection', 'analysis', 'demonstration'] as const;
export type VerificationMethod = (typeof VERIFICATION_METHODS)[number];

export interface Audit {
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  version: number;
}

export interface StandardRef {
  /** e.g. "ISO 26262", "EU MDR 2017/745" */
  standard: string;
  /** e.g. "Part 6, 9.4" */
  clause?: string;
}

export interface Requirement extends Audit {
  id: string;
  /** External identifier from the source document, unique per project. */
  reqId: string;
  title: string;
  text: string;
  type: RequirementType;
  level: Level;
  verificationMethod: VerificationMethod;
  standards: StandardRef[];
  status: 'active' | 'obsolete';
}

export interface TestStep {
  action: string;
  expected: string;
}

export const TEST_STATUSES = ['draft', 'ready', 'obsolete'] as const;
export type TestStatus = (typeof TEST_STATUSES)[number];

export interface TestCase extends Audit {
  id: string;
  tid: string;
  title: string;
  objective: string;
  preconditions: string;
  steps: TestStep[];
  passCriteria: string;
  /** Environmental conditions: temperature, supply voltage, humidity... */
  environment: string;
  requirementIds: string[];
  equipmentIds: string[];
  /** Instruments the test needs that are not (yet) in the equipment catalogue. */
  missingEquipment?: string[];
  status: TestStatus;
  estimatedMinutes: number;
  /** Set when a linked requirement changed after the test was written. */
  suspect: boolean;
  suspectReason?: string;
}

export const EQUIPMENT_KINDS = ['standard', 'company'] as const;
export type EquipmentKind = (typeof EQUIPMENT_KINDS)[number];

export const EQUIPMENT_STATUSES = ['available', 'in_repair', 'to_be_built', 'to_procure'] as const;
export type EquipmentStatus = (typeof EQUIPMENT_STATUSES)[number];

export interface Equipment extends Audit {
  id: string;
  name: string;
  kind: EquipmentKind;
  category: string;
  model: string;
  serial: string;
  /** ISO date (yyyy-mm-dd). Empty when no calibration is needed. */
  calibrationDue: string;
  status: EquipmentStatus;
  notes: string;
}

export const PLAN_STATUSES = ['draft', 'review', 'approved'] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export type EquipmentScope = 'all' | 'standard' | 'company';

export interface PlanItem {
  testCaseId: string;
  order: number;
}

export interface TestPlan extends Audit {
  id: string;
  name: string;
  scope: string;
  status: PlanStatus;
  /** Which equipment kinds this plan is restricted to when selecting tests. */
  equipmentScope: EquipmentScope;
  items: PlanItem[];
  notes: string;
}

export interface AuditEntry {
  at: string;
  user: string;
  action: string;
  entity: string;
  entityId: string;
  detail: string;
}

export interface ProjectData {
  schemaVersion: 1;
  name: string;
  requirements: Requirement[];
  testCases: TestCase[];
  equipment: Equipment[];
  plans: TestPlan[];
  auditLog: AuditEntry[];
}

export const emptyProject = (name = 'Untitled project'): ProjectData => ({
  schemaVersion: 1,
  name,
  requirements: [],
  testCases: [],
  equipment: [],
  plans: [],
  auditLog: [],
});
