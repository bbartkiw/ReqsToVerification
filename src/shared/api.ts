import type { ProposedTest } from '../core/generate';
import type { ColumnMapping, DraftIssue, RawTable } from '../core/importers';
import type { ImportResult } from '../core/service';
import type { Equipment, ProjectData, Requirement, TestCase, TestPlan } from '../core/types';

type New<T> = Omit<T, 'createdBy' | 'createdAt' | 'updatedBy' | 'updatedAt' | 'version' | 'id'> & { id?: string };

export interface ProjectInfo {
  data: ProjectData;
  path: string;
}

export interface ImportFileResult {
  fileName: string;
  table: RawTable;
  mapping: ColumnMapping;
}

export interface ImportPreview {
  count: number;
  issues: DraftIssue[];
  newCount: number;
  changedCount: number;
}

/** Everything the renderer may ask the main process to do. */
export interface Api {
  getProject(): Promise<ProjectInfo>;
  newProject(): Promise<ProjectInfo | null>;
  openProject(): Promise<ProjectInfo | null>;
  renameProject(name: string): Promise<ProjectInfo>;

  pickImportFile(): Promise<ImportFileResult | null>;
  previewImport(table: RawTable, mapping: ColumnMapping): Promise<ImportPreview>;
  commitImport(table: RawTable, mapping: ColumnMapping): Promise<{ result: ImportResult; project: ProjectInfo }>;

  saveRequirement(r: New<Requirement>): Promise<ProjectInfo>;
  deleteRequirement(id: string): Promise<ProjectInfo>;
  saveTestCase(t: New<TestCase>): Promise<ProjectInfo>;
  createGeneratedTests(proposals: ProposedTest[], planName?: string): Promise<ProjectInfo>;
  clearSuspect(id: string): Promise<ProjectInfo>;
  deleteTestCase(id: string): Promise<ProjectInfo>;
  saveEquipment(e: New<Equipment>): Promise<ProjectInfo>;
  deleteEquipment(id: string): Promise<ProjectInfo>;
  savePlan(p: New<TestPlan>): Promise<ProjectInfo>;
  deletePlan(id: string): Promise<ProjectInfo>;

  exportPlanXlsx(planId: string): Promise<string | null>;
  exportPlanPdf(planId: string): Promise<string | null>;
  exportEquipmentList(planId: string): Promise<string | null>;
}

export type ApiMethod = keyof Api;

export const API_METHODS: ApiMethod[] = [
  'getProject',
  'newProject',
  'openProject',
  'renameProject',
  'pickImportFile',
  'previewImport',
  'commitImport',
  'saveRequirement',
  'deleteRequirement',
  'saveTestCase',
  'createGeneratedTests',
  'clearSuspect',
  'deleteTestCase',
  'saveEquipment',
  'deleteEquipment',
  'savePlan',
  'deletePlan',
  'exportPlanXlsx',
  'exportPlanPdf',
  'exportEquipmentList',
];
