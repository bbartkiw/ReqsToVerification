import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { promises as fs } from 'node:fs';
import { basename, join } from 'node:path';
import { buildEquipmentWorkbook, buildPlanHtml, buildPlanWorkbook } from '../core/export';
import { importSources, mapRows, sourceForFile, guessMapping, type ColumnMapping, type RawTable } from '../core/importers';
import { JsonFileRepository } from '../core/repository';
import { applyImport, ProjectService } from '../core/service';
import { API_METHODS, type Api, type ProjectInfo } from '../shared/api';

let win: BrowserWindow | null = null;
let service: ProjectService;
let projectPath = '';

const settingsPath = (): string => join(app.getPath('userData'), 'settings.json');
const defaultProjectPath = (): string => join(app.getPath('userData'), 'project.json');

async function readSettings(): Promise<{ lastProject?: string }> {
  try {
    return JSON.parse(await fs.readFile(settingsPath(), 'utf-8')) as { lastProject?: string };
  } catch {
    return {};
  }
}

async function openPath(path: string): Promise<void> {
  const s = new ProjectService(new JsonFileRepository(path), process.env.USERNAME ?? 'local-user');
  await s.init();
  service = s;
  projectPath = path;
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  await fs.writeFile(settingsPath(), JSON.stringify({ lastProject: path }), 'utf-8');
}

const info = (): ProjectInfo => ({ data: service.getData(), path: projectPath });

const safeName = (s: string): string => s.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'export';

async function pickSavePath(title: string, name: string, ext: string, label: string): Promise<string | null> {
  const r = await dialog.showSaveDialog(win!, { title, defaultPath: `${safeName(name)}.${ext}`, filters: [{ name: label, extensions: [ext] }] });
  return r.canceled || !r.filePath ? null : r.filePath;
}

const findPlan = (id: string) => {
  const plan = service.getData().plans.find((p) => p.id === id);
  if (!plan) throw new Error('Plan not found.');
  return plan;
};

const handlers: Api = {
  getProject: async () => info(),

  async newProject() {
    const path = await pickSavePath('Create project file', 'new-project', 'rtv.json', 'Project');
    if (!path) return null;
    await fs.rm(path, { force: true });
    await openPath(path);
    await service.newProject(basename(path).replace(/\.rtv\.json$|\.json$/i, ''));
    return info();
  },

  async openProject() {
    const r = await dialog.showOpenDialog(win!, { title: 'Open project', properties: ['openFile'], filters: [{ name: 'Project', extensions: ['json'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    await openPath(r.filePaths[0]);
    return info();
  },

  async renameProject(name) {
    await service.renameProject(name);
    return info();
  },

  async pickImportFile() {
    const exts = importSources.flatMap((s) => s.extensions);
    const r = await dialog.showOpenDialog(win!, {
      title: 'Import requirements',
      properties: ['openFile'],
      filters: [{ name: 'Requirements (CSV, Excel)', extensions: exts }],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const file = r.filePaths[0];
    const source = sourceForFile(file);
    if (!source) throw new Error('Unsupported file type.');
    const table = await source.parse(new Uint8Array(await fs.readFile(file)));
    return { fileName: basename(file), table, mapping: guessMapping(table.headers) };
  },

  async previewImport(table: RawTable, mapping: ColumnMapping) {
    const { drafts, issues } = mapRows(table, mapping);
    const scratch = structuredClone(service.getData());
    const res = applyImport(scratch, drafts, 'preview', new Date());
    return { count: drafts.length, issues, newCount: res.added.length, changedCount: res.updated.length };
  },

  async commitImport(table, mapping) {
    const { drafts } = mapRows(table, mapping);
    const result = await service.importRequirements(drafts);
    return { result, project: info() };
  },

  saveRequirement: async (r) => (await service.saveRequirement(r), info()),
  deleteRequirement: async (id) => (await service.deleteRequirement(id), info()),
  saveTestCase: async (t) => (await service.saveTestCase(t), info()),
  createGeneratedTests: async (proposals, planName) => (await service.createGenerated(proposals, planName), info()),
  clearSuspect: async (id) => (await service.clearSuspect(id), info()),
  deleteTestCase: async (id) => (await service.deleteTestCase(id), info()),
  saveEquipment: async (e) => (await service.saveEquipment(e), info()),
  deleteEquipment: async (id) => (await service.deleteEquipment(id), info()),
  savePlan: async (p) => (await service.savePlan(p), info()),
  deletePlan: async (id) => (await service.deletePlan(id), info()),

  async exportPlanXlsx(planId) {
    const plan = findPlan(planId);
    const path = await pickSavePath('Export test plan', `${plan.name}-v${plan.version}`, 'xlsx', 'Excel');
    if (!path) return null;
    await fs.writeFile(path, await buildPlanWorkbook(service.getData(), plan));
    shell.showItemInFolder(path);
    return path;
  },

  async exportEquipmentList(planId) {
    const plan = findPlan(planId);
    const path = await pickSavePath('Export equipment list', `${plan.name}-equipment`, 'xlsx', 'Excel');
    if (!path) return null;
    await fs.writeFile(path, await buildEquipmentWorkbook(service.getData(), plan));
    shell.showItemInFolder(path);
    return path;
  },

  async exportPlanPdf(planId) {
    const plan = findPlan(planId);
    const path = await pickSavePath('Export test plan', `${plan.name}-v${plan.version}`, 'pdf', 'PDF');
    if (!path) return null;
    const printWin = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
    try {
      const html = buildPlanHtml(service.getData(), plan);
      await printWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      const pdf = await printWin.webContents.printToPDF({ pageSize: 'A4', printBackground: true });
      await fs.writeFile(path, pdf);
    } finally {
      printWin.destroy();
    }
    shell.showItemInFolder(path);
    return path;
  },
};

function registerIpc(): void {
  for (const name of API_METHODS) {
    ipcMain.handle(`api:${name}`, (_e, ...args: unknown[]) =>
      (handlers[name] as (...a: unknown[]) => Promise<unknown>)(...args),
    );
  }
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Requirements to Verification',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setMenuBarVisibility(false);
  // Block navigation away from the app and external window creation.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  void win.loadFile(join(__dirname, '..', 'renderer', 'index.html'));
}

app.whenReady().then(async () => {
  const last = (await readSettings()).lastProject;
  let path = last ?? defaultProjectPath();
  try {
    await openPath(path);
  } catch {
    path = defaultProjectPath();
    await openPath(path);
  }
  registerIpc();
  createWindow();
});

app.on('window-all-closed', () => app.quit());
