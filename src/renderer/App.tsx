import { useCallback, useEffect, useState } from 'react';
import type { ProjectInfo } from '../shared/api';
import { Dashboard } from './views/Dashboard';
import { EquipmentView } from './views/EquipmentView';
import { PlansView } from './views/PlansView';
import { RequirementsView } from './views/RequirementsView';
import { TestCasesView } from './views/TestCasesView';
import { AppCtx } from './ui';

const TABS = ['Dashboard', 'Requirements', 'Test cases', 'Equipment', 'Test plans'] as const;
type Tab = (typeof TABS)[number];

export function App() {
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [tab, setTab] = useState<Tab>('Dashboard');
  const [msg, setMsg] = useState<{ text: string; kind: 'error' | 'info' } | null>(null);

  useEffect(() => {
    window.api.getProject().then(setProject, (e: Error) => setMsg({ text: e.message, kind: 'error' }));
  }, []);

  const notify = useCallback((text: string, kind: 'error' | 'info' = 'info') => setMsg({ text, kind }), []);
  const apply = useCallback(
    async (p: Promise<ProjectInfo>) => {
      try {
        setProject(await p);
        return true;
      } catch (e) {
        setMsg({ text: (e as Error).message.replace(/^Error invoking remote method '[^']*': (Error: )?/, ''), kind: 'error' });
        return false;
      }
    },
    [],
  );

  if (!project) return <p>Loading...</p>;

  const switchProject = async (fn: () => Promise<ProjectInfo | null>) => {
    try {
      const p = await fn();
      if (p) setProject(p);
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  };

  return (
    <AppCtx.Provider value={{ data: project.data, path: project.path, apply, setProject, notify }}>
      <div className="app">
        <header className="top">
          <h1>{project.data.name}</h1>
          <span className="path" title={project.path}>{project.path}</span>
          <button onClick={() => switchProject(() => window.api.newProject())}>New project</button>
          <button onClick={() => switchProject(() => window.api.openProject())}>Open project</button>
        </header>
        <nav className="tabs" role="tablist" aria-label="Sections">
          {TABS.map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </nav>
        {msg && (
          <div className={`banner ${msg.kind}`} role={msg.kind === 'error' ? 'alert' : 'status'}>
            <span>{msg.text}</span>
            <button onClick={() => setMsg(null)} aria-label="Dismiss message">Dismiss</button>
          </div>
        )}
        <main role="tabpanel">
          {tab === 'Dashboard' && <Dashboard />}
          {tab === 'Requirements' && <RequirementsView />}
          {tab === 'Test cases' && <TestCasesView />}
          {tab === 'Equipment' && <EquipmentView />}
          {tab === 'Test plans' && <PlansView />}
        </main>
      </div>
    </AppCtx.Provider>
  );
}
