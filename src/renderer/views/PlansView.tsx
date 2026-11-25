import { useEffect, useMemo, useState } from 'react';
import { analysePlan, equipmentList, selectTestsByScope, suggestOrder } from '../../core/analysis';
import { PLAN_STATUSES, type EquipmentScope, type TestPlan } from '../../core/types';
import { Badge, Field, Select, useApp } from '../ui';
import { EquipmentGenDialog } from './EquipmentGenDialog';
import { SpecDialog } from './SpecDialog';

const SCOPE_LABELS: Record<EquipmentScope, string> = {
  all: 'All equipment',
  standard: 'Standard equipment only',
  company: 'Tests using company-specific equipment',
};

type Draft = Omit<TestPlan, 'createdBy' | 'createdAt' | 'updatedBy' | 'updatedAt' | 'version' | 'id'> & { id?: string; version?: number };

const blank = (): Draft => ({ name: 'New test plan', scope: '', status: 'draft', equipmentScope: 'all', items: [], notes: '' });

export function PlansView() {
  const { data, apply, notify } = useApp();
  const [selId, setSelId] = useState<string | null>(data.plans[0]?.id ?? null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [specOpen, setSpecOpen] = useState(false);
  const [eqGenOpen, setEqGenOpen] = useState(false);

  useEffect(() => {
    const p = data.plans.find((x) => x.id === selId);
    if (p && !dirty) setDraft(structuredClone(p));
    if (!selId && !dirty) setDraft(null);
  }, [selId, data.plans, dirty]);

  const choose = (id: string | null, d?: Draft) => {
    if (dirty && !confirm('Discard unsaved changes to the current plan?')) return;
    setDirty(false);
    setSelId(id);
    setDraft(d ?? null);
    if (d) setDirty(true);
  };

  const edit = (patch: Partial<Draft>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
    setDirty(true);
  };

  const report = useMemo(
    () => (draft ? analysePlan(data, { ...(draft as TestPlan), id: draft.id ?? '' }) : null),
    [data, draft],
  );

  const equip = useMemo(
    () => (draft ? equipmentList(data, { ...(draft as TestPlan), id: draft.id ?? '' }) : { items: [], missing: [] }),
    [data, draft],
  );

  const save = async () => {
    if (!draft) return;
    const before = new Set(data.plans.map((p) => p.id));
    try {
      const info = await window.api.savePlan(draft as TestPlan);
      setDirty(false);
      // select the new plan if one was created
      const created = info.data.plans.find((p) => !before.has(p.id));
      await apply(Promise.resolve(info));
      if (created) setSelId(created.id);
      notify('Plan saved.');
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  };

  const inPlan = new Set(draft?.items.map((i) => i.testCaseId));
  const candidates = draft ? selectTestsByScope(data, draft.equipmentScope).filter((t) => !inPlan.has(t.id)) : [];
  const move = (i: number, d: number) => {
    if (!draft) return;
    const items = [...draft.items];
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    [items[i], items[j]] = [items[j], items[i]];
    edit({ items: items.map((it, n) => ({ ...it, order: n + 1 })) });
  };
  const add = (ids: string[]) =>
    draft && edit({ items: [...draft.items, ...ids.map((testCaseId) => ({ testCaseId, order: 0 }))].map((it, n) => ({ ...it, order: n + 1 })) });

  const doExport = async (kind: 'xlsx' | 'pdf') => {
    if (!draft?.id) return;
    try {
      if (dirty) await save();
      const path = await (kind === 'xlsx' ? window.api.exportPlanXlsx(draft.id) : window.api.exportPlanPdf(draft.id));
      if (path) notify(`Exported to ${path}`);
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  };

  return (
    <div className="split">
      <div>
        <div className="toolbar"><button className="primary" onClick={() => choose(null, blank())}>New plan</button></div>
        <div className="list">
          {data.plans.map((p) => (
            <button key={p.id} aria-current={p.id === selId} onClick={() => choose(p.id)}>
              <b>{p.name}</b><br /><span className="muted">v{p.version} - {p.status} - {p.items.length} tests</span>
            </button>
          ))}
          {data.plans.length === 0 && <p className="muted">No plans yet.</p>}
        </div>
      </div>

      {draft && report ? (
        <div>
          <div className="panel">
            <div className="form">
              <Field label="Plan name">{(id) => <input id={id} value={draft.name} onChange={(e) => edit({ name: e.target.value })} />}</Field>
              <Field label="Status">{(id) => <Select id={id} value={draft.status} options={PLAN_STATUSES} onChange={(v) => edit({ status: v })} />}</Field>
              <Field label="Equipment focus (used when adding tests, and checked in the plan)">
                {(id) => <Select id={id} value={draft.equipmentScope} options={['all', 'standard', 'company'] as const} labels={SCOPE_LABELS} onChange={(v) => edit({ equipmentScope: v })} />}
              </Field>
              <Field label="Scope / purpose">{(id) => <input id={id} value={draft.scope} onChange={(e) => edit({ scope: e.target.value })} />}</Field>
              <Field label="Notes" full>{(id) => <textarea id={id} value={draft.notes} onChange={(e) => edit({ notes: e.target.value })} />}</Field>
            </div>
            <div className="toolbar" style={{ marginTop: 10 }}>
              <button className="primary" onClick={save} disabled={!dirty || !draft.name.trim()}>Save plan</button>
              <button onClick={() => doExport('xlsx')} disabled={!draft.id}>Export Excel</button>
              <button onClick={() => doExport('pdf')} disabled={!draft.id}>Export PDF</button>
              <button onClick={() => setSpecOpen(true)} disabled={!draft.id || dirty} title={dirty ? 'Save the plan first' : undefined}>Test specification...</button>
              <span className="spacer" />
              {draft.id && (
                <button className="danger" onClick={async () => { if (confirm(`Delete plan "${draft.name}"?`)) { setDirty(false); if (await apply(window.api.deletePlan(draft.id!))) setSelId(null); } }}>Delete plan</button>
              )}
            </div>
            {dirty && <span className="issue-warning">Unsaved changes</span>}
          </div>

          <div className="kpis">
            <div className="kpi"><div className="muted">Test cases</div><div className="v">{report.tests.length}</div></div>
            <div className="kpi"><div className="muted">Effort</div><div className="v">{Math.floor(report.totalMinutes / 60)} h {report.totalMinutes % 60} m</div></div>
            <div className="kpi"><div className="muted">Requirements covered</div><div className="v">{report.coveredRequirementIds.length}</div></div>
            <div className="kpi"><div className="muted">Verifiable, not in plan</div><div className="v">{report.uncoveredInPlan.length}</div></div>
          </div>

          <div className="panel">
            <h3>Tests in plan</h3>
            <div className="toolbar">
              <button onClick={() => edit({ items: suggestOrder(data, draft.items.map((i) => i.testCaseId)).map((testCaseId, n) => ({ testCaseId, order: n + 1 })) })} disabled={draft.items.length < 2}>
                Group by equipment (minimise rig changes)
              </button>
            </div>
            <table className="grid">
              <thead><tr><th>#</th><th>Test</th><th>Requirements</th><th>Equipment</th><th className="num">Min</th><th /></tr></thead>
              <tbody>
                {report.tests.map((t, i) => (
                  <tr key={t.id}>
                    <td>{i + 1}</td>
                    <td><b>{t.tid}</b> {t.title}{t.suspect && <> <Badge kind="warn">suspect</Badge></>}</td>
                    <td>{t.requirementIds.map((r) => <Badge key={r}>{data.requirements.find((x) => x.id === r)?.reqId}</Badge>)}</td>
                    <td>{t.equipmentIds.map((e) => { const eq = data.equipment.find((x) => x.id === e); return <Badge key={e} kind={eq?.kind === 'company' ? 'company' : undefined}>{eq?.name ?? '?'}</Badge>; })}</td>
                    <td className="num">{t.estimatedMinutes}</td>
                    <td>
                      <button aria-label={`Move ${t.tid} up`} onClick={() => move(i, -1)}>Up</button>{' '}
                      <button aria-label={`Move ${t.tid} down`} onClick={() => move(i, 1)}>Down</button>{' '}
                      <button aria-label={`Remove ${t.tid}`} onClick={() => edit({ items: draft.items.filter((x) => x.testCaseId !== t.id).map((x, n) => ({ ...x, order: n + 1 })) })}>Remove</button>
                    </td>
                  </tr>
                ))}
                {report.tests.length === 0 && <tr><td colSpan={6} className="muted">Add test cases below.</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="panel">
            <h3>Available tests matching "{SCOPE_LABELS[draft.equipmentScope]}" ({candidates.length})</h3>
            <div className="toolbar">
              <button onClick={() => add(candidates.map((t) => t.id))} disabled={candidates.length === 0}>Add all {candidates.length}</button>
            </div>
            <table className="grid">
              <tbody>
                {candidates.map((t) => (
                  <tr key={t.id}>
                    <td>{t.tid}</td><td>{t.title}</td>
                    <td>{t.equipmentIds.map((e) => data.equipment.find((x) => x.id === e)?.name).join(', ') || <span className="muted">no equipment</span>}</td>
                    <td><button onClick={() => add([t.id])}>Add</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="panel">
            <h3>Checks</h3>
            {report.issues.length === 0 ? <p className="issue-info">No issues found.</p> : (
              <ul className="plain">{report.issues.map((i, n) => <li key={n} className={`issue-${i.severity}`}><b>{i.severity}</b>: {i.message}</li>)}</ul>
            )}
          </div>

          <div className="panel">
            <div className="toolbar">
              <h3 style={{ margin: 0 }}>Required test equipment</h3>
              <span className="spacer" />
              <button
                disabled={!draft.id || (equip.items.length === 0 && equip.missing.length === 0)}
                onClick={async () => {
                  try {
                    if (dirty) await save();
                    const path = await window.api.exportEquipmentList(draft.id!);
                    if (path) notify(`Exported to ${path}`);
                  } catch (e) {
                    notify((e as Error).message, 'error');
                  }
                }}
              >
                Export equipment list (Excel)
              </button>
            </div>
            {equip.items.length === 0 && equip.missing.length === 0 ? (
              <p className="muted">No equipment needed yet. Link equipment to the test cases in this plan.</p>
            ) : (
              <>
                <table className="grid">
                  <thead><tr><th>Equipment</th><th>Kind</th><th>Calibration</th><th>Status</th><th className="num">Tests</th><th>Used by</th><th className="num">Min</th></tr></thead>
                  <tbody>
                    {equip.items.map((u) => (
                      <tr key={u.equipment.id}>
                        <td>{u.equipment.name}{u.equipment.model && <span className="muted"> {u.equipment.model}</span>}</td>
                        <td><Badge kind={u.equipment.kind === 'company' ? 'company' : undefined}>{u.equipment.kind === 'company' ? 'Company-specific' : 'Standard'}</Badge></td>
                        <td>{u.calibration === 'none' ? <span className="muted">not required</span> : <Badge kind={u.calibration === 'ok' ? 'ok' : u.calibration === 'due-soon' ? 'warn' : 'err'}>{u.equipment.calibrationDue}</Badge>}</td>
                        <td><Badge kind={u.equipment.status === 'available' ? 'ok' : u.equipment.status === 'in_repair' ? 'err' : 'warn'}>{u.equipment.status.replace(/_/g, ' ')}</Badge></td>
                        <td className="num">{u.testCaseIds.length}</td>
                        <td>{u.testCaseIds.map((id) => <Badge key={id}>{data.testCases.find((t) => t.id === id)?.tid}</Badge>)}</td>
                        <td className="num">{u.minutes}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {equip.missing.length > 0 && (
                  <>
                    <div className="toolbar" style={{ marginTop: 12 }}>
                      <h3 style={{ margin: 0 }}>Equipment to obtain (not in the catalogue)</h3>
                      <span className="spacer" />
                      <button disabled={!draft.id || dirty} onClick={() => setEqGenOpen(true)}>Add to equipment catalogue...</button>
                    </div>
                    <table className="grid">
                      <thead><tr><th>Needed</th><th>Used by</th><th>Requirements</th></tr></thead>
                      <tbody>
                        {equip.missing.map((m) => (
                          <tr key={m.need}>
                            <td>{m.need}</td>
                            <td>{m.testCaseIds.map((id) => <Badge key={id} kind="warn">{data.testCases.find((t) => t.id === id)?.tid}</Badge>)}</td>
                            <td>{m.requirementIds.map((id) => <Badge key={id}>{data.requirements.find((r) => r.id === id)?.reqId}</Badge>)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      ) : (
        <p className="muted">Select a plan or create a new one.</p>
      )}
      {specOpen && draft?.id && <SpecDialog plan={draft as TestPlan} onClose={() => setSpecOpen(false)} />}
      {eqGenOpen && draft?.id && <EquipmentGenDialog planId={draft.id} onClose={() => setEqGenOpen(false)} />}
    </div>
  );
}
