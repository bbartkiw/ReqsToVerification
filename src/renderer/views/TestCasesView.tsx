import { useState } from 'react';
import { TEST_STATUSES, type TestCase } from '../../core/types';
import { Badge, Field, Modal, MultiPicker, Select, useApp } from '../ui';

const blank = (): Partial<TestCase> => ({
  tid: '',
  title: '',
  objective: '',
  preconditions: '',
  steps: [{ action: '', expected: '' }],
  passCriteria: '',
  environment: '',
  requirementIds: [],
  equipmentIds: [],
  status: 'draft',
  estimatedMinutes: 15,
  suspect: false,
});

export function TestCasesView() {
  const { data, apply } = useApp();
  const [q, setQ] = useState('');
  const [flt, setFlt] = useState('');
  const [edit, setEdit] = useState<Partial<TestCase> | null>(null);

  const reqLabel = (id: string) => data.requirements.find((r) => r.id === id)?.reqId ?? '?';
  const eq = (id: string) => data.equipment.find((e) => e.id === id);
  const rows = data.testCases.filter(
    (t) =>
      (flt === '' ||
        (flt === 'suspect' && t.suspect) ||
        (flt === 'orphan' && t.requirementIds.length === 0) ||
        (flt === 'company' && t.equipmentIds.some((e) => eq(e)?.kind === 'company')) ||
        (flt === 'standard' && t.equipmentIds.every((e) => eq(e)?.kind === 'standard'))) &&
      `${t.tid} ${t.title} ${t.requirementIds.map(reqLabel).join(' ')}`.toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <>
      <div className="toolbar">
        <input type="search" placeholder="Search test cases..." aria-label="Search test cases" value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="Filter test cases" value={flt} onChange={(e) => setFlt(e.target.value)}>
          <option value="">All test cases</option>
          <option value="suspect">Suspect (requirement changed)</option>
          <option value="orphan">Not linked to a requirement</option>
          <option value="standard">Standard equipment only</option>
          <option value="company">Uses company-specific equipment</option>
        </select>
        <span className="spacer" />
        <button className="primary" onClick={() => setEdit(blank())}>New test case</button>
      </div>
      <table className="grid">
        <thead><tr><th>ID</th><th>Title</th><th>Requirements</th><th>Equipment</th><th className="num">Min</th><th>Status</th><th /></tr></thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id}>
              <td>{t.tid}</td>
              <td>{t.title}{t.suspect && <> <Badge kind="warn">suspect</Badge></>}</td>
              <td>{t.requirementIds.map((r) => <Badge key={r}>{reqLabel(r)}</Badge>)}</td>
              <td>{t.equipmentIds.map((e) => <Badge key={e} kind={eq(e)?.kind === 'company' ? 'company' : undefined}>{eq(e)?.name ?? '?'}</Badge>)}</td>
              <td className="num">{t.estimatedMinutes}</td>
              <td>{t.status}</td>
              <td>
                {t.suspect && <button onClick={() => apply(window.api.clearSuspect(t.id))} title={t.suspectReason}>Confirm valid</button>}{' '}
                <button onClick={() => setEdit(t)}>Edit</button>
              </td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={7} className="muted">No test cases yet.</td></tr>}
        </tbody>
      </table>
      {edit && <TestCaseDialog initial={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function TestCaseDialog({ initial, onClose }: { initial: Partial<TestCase>; onClose: () => void }) {
  const { data, apply } = useApp();
  const [t, setT] = useState(initial);
  const set = <K extends keyof TestCase>(k: K, v: TestCase[K]) => setT((p) => ({ ...p, [k]: v }));
  const steps = t.steps ?? [];
  const setStep = (i: number, k: 'action' | 'expected', v: string) =>
    set('steps', steps.map((s, n) => (n === i ? { ...s, [k]: v } : s)));

  const save = async () => {
    const ok = await apply(window.api.saveTestCase({ ...(t as TestCase), steps: steps.filter((s) => s.action.trim() || s.expected.trim()) }));
    if (ok) onClose();
  };

  return (
    <Modal
      title={t.id ? `Edit ${t.tid}` : 'New test case'}
      onClose={onClose}
      footer={
        <>
          {t.id && (
            <button className="danger" onClick={async () => { if (confirm(`Delete ${t.tid}? It is removed from all plans.`) && (await apply(window.api.deleteTestCase(t.id!)))) onClose(); }}>Delete</button>
          )}
          <span className="spacer" />
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!t.title?.trim()} onClick={save}>Save</button>
        </>
      }
    >
      {t.suspect && <p className="issue-warning" role="status">Suspect: {t.suspectReason}</p>}
      <div className="form">
        <Field label="Test ID (blank = automatic)">{(id) => <input id={id} value={t.tid ?? ''} onChange={(e) => set('tid', e.target.value)} />}</Field>
        <Field label="Title *">{(id) => <input id={id} value={t.title ?? ''} onChange={(e) => set('title', e.target.value)} />}</Field>
        <Field label="Objective" full>{(id) => <textarea id={id} value={t.objective ?? ''} onChange={(e) => set('objective', e.target.value)} />}</Field>
        <Field label="Preconditions">{(id) => <textarea id={id} value={t.preconditions ?? ''} onChange={(e) => set('preconditions', e.target.value)} />}</Field>
        <Field label="Environment (temperature, supply voltage, humidity...)">{(id) => <textarea id={id} value={t.environment ?? ''} onChange={(e) => set('environment', e.target.value)} />}</Field>

        <div className="field full steps">
          <span className="lbl">Steps</span>
          {steps.map((s, i) => (
            <div className="step" key={i}>
              <span>{i + 1}.</span>
              <textarea aria-label={`Step ${i + 1} action`} placeholder="Action" value={s.action} onChange={(e) => setStep(i, 'action', e.target.value)} />
              <textarea aria-label={`Step ${i + 1} expected result`} placeholder="Expected result (with units / tolerance)" value={s.expected} onChange={(e) => setStep(i, 'expected', e.target.value)} />
              <button aria-label={`Remove step ${i + 1}`} onClick={() => set('steps', steps.filter((_, n) => n !== i))}>x</button>
            </div>
          ))}
          <button onClick={() => set('steps', [...steps, { action: '', expected: '' }])}>Add step</button>
        </div>

        <Field label="Pass criteria" full>{(id) => <textarea id={id} value={t.passCriteria ?? ''} onChange={(e) => set('passCriteria', e.target.value)} />}</Field>
        <Field label="Estimated minutes">{(id) => <input id={id} type="number" min={0} value={t.estimatedMinutes ?? 0} onChange={(e) => set('estimatedMinutes', Math.max(0, Number(e.target.value)))} />}</Field>
        <Field label="Status">{(id) => <Select id={id} value={t.status ?? 'draft'} options={TEST_STATUSES} onChange={(v) => set('status', v)} />}</Field>

        <MultiPicker
          label="Requirements verified by this test (many-to-many)"
          items={data.requirements.filter((r) => r.status === 'active').map((r) => ({ id: r.id, label: r.reqId, sub: `${r.title} [${r.verificationMethod}]` }))}
          selected={t.requirementIds ?? []}
          onChange={(v) => set('requirementIds', v)}
        />
        <MultiPicker
          label="Equipment"
          items={data.equipment.map((e) => ({ id: e.id, label: e.name, sub: e.kind === 'company' ? '(company-specific)' : '(standard)' }))}
          selected={t.equipmentIds ?? []}
          onChange={(v) => set('equipmentIds', v)}
        />
      </div>
    </Modal>
  );
}
