import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { emptyProject, type ProjectData } from './types';

/**
 * Storage boundary. The local app uses a JSON file; a shared database
 * (Postgres, etc.) can implement the same interface for multi-user use.
 */
export interface Repository {
  load(): Promise<ProjectData>;
  save(data: ProjectData): Promise<void>;
}

export class JsonFileRepository implements Repository {
  constructor(private readonly path: string) {}

  async load(): Promise<ProjectData> {
    try {
      const raw = await fs.readFile(this.path, 'utf-8');
      const parsed = JSON.parse(raw) as ProjectData;
      if (parsed.schemaVersion !== 1) throw new Error(`Unsupported project schema version: ${String(parsed.schemaVersion)}`);
      return { ...emptyProject(parsed.name), ...parsed };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return emptyProject();
      throw e;
    }
  }

  async save(data: ProjectData): Promise<void> {
    await fs.mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
    await fs.rename(tmp, this.path); // atomic replace so a crash cannot corrupt the project
  }
}

export class MemoryRepository implements Repository {
  constructor(public data: ProjectData = emptyProject()) {}
  async load(): Promise<ProjectData> {
    return structuredClone(this.data);
  }
  async save(data: ProjectData): Promise<void> {
    this.data = structuredClone(data);
  }
}
