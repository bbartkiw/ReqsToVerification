import { useMemo, useState } from 'react';
import { coveredRequirementIds } from '../../core/analysis';
import { STANDARD_SUGGESTIONS } from '../../core/standards';
import {
  LEVELS,
  REQUIREMENT_TYPES,
  VERIFICATION_METHODS,
  isNonFunctional,
  type Requirement,
  type StandardRef,
} from '../../core/types';
import type { ImportFileResult, ImportPreview } from '../../shared/api';
import type { ImportResult } from '../../core/service';
import { Badge, Field, Modal, Select, useApp } from '../ui';

const FIELD_LABELS = {
  reqId: 'Requirement ID *',
  title: 'Title',
  text: 'Requirement text',
  type: 'Type / category',
  level: 'V-model level',
  verificationMethod: 'Verification method',
  standards: 'Standards (e.g. ISO 26262 (Part 6); EU MDR)',
} as const;
type FieldKey = keyof typeof FIELD_LABELS;

export function RequirementsView() {
  const { data } = useApp();
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [level, setLevel] = useState('');
  const [method, setMethod] = useState('');
  const [nfr, setNfr] = useState('');
  const [edit, setEdit] = useState<Partial<Requirement> | null>(null);
  const [importing, setImporting] = useState(false);

  const covered = useMemo(() => coveredRequirementIds(data.testCases.filter((t) => t.status !== 'obsolete')), [data.testCases]);
  const rows = data.requirements.filter(
    (r) =>
      (!type || r.type === type) &&
      (!level || r.level === level) &&
      (!method || r.verificationMethod === method) &&
      (!nfr || (nfr === 'nfr') === isNonFunctional(r.type)) &&
      `${r.reqId} ${r.title} ${r.text} ${r.standards.map((s) => s.standard).join(' ')}`.toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <>
      <div className="toolbar">
        <input type="search" placeholder="Search requirements..." aria-label="Search requirements" value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="Filter by type" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All types</option>
          {REQUIREMENT_TYPES.map((t) => <option key={t}>{t}</option>)}
        </select>
        <select aria-label="Functional or non-functional" value={nfr} onChange={(e) => setNfr(e.target.value)}>
          <option value="">Functional + non-functional</option>
          <option value="f">Functional only</option>
          <option value="nfr">Non-functional only</option>
        </select>
        <select aria-label="Filter by level" value={level} onChange={(e) => setLevel(e.target.value)}>
          <option value="">All levels</option>
          {LEVELS.map((t) => <option key={t}>{t}</option>)}
        </select>
        <select aria-label="Filter by verification method" value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="">All methods</option>
          {VERIFICATION_METHODS.map((t) => <option key={t}>{t}</option>)}
        </select>
        <span className="spacer" />
        <span className="muted">{rows.length} of {data.requirements.length}</span>
        <button onClick={() => setImporting(true)} className="primary">Import CSV / Excel...</button>
        <button onClick={() => setEdit({ type: 'functional', level: 'system', verificationMethod: 'test', standards: [], title: '', text: '', reqId: '' })}>New requirement</button>
      </div>

      <table className="grid">
        <thead>
          <tr><th>ID</th><th>Title / text</th><th>Type</th><th>Level</th><th>Method</th><th>Standards</th><th className="num">Ver.</th><th>Tests</th><th /></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} style={r.status === 'obsolete' ? { opacity: 0.5 } : undefined}>
              <td>{r.reqId}</td>
              <td><b>{r.title}</b><div className="muted">{r.text}</div></td>
              <td>{r.type}{isNonFunctional(r.type) && <> <Badge>NFR</Badge></>}</td>
              <td>{r.level}</td>
              <td>{r.verificationMethod}</td>
              <td>{r.standards.map((s, i) => <Badge key={i}>{s.standard}{s.clause ? ` (${s.clause})` : ''}</Badge>)}</td>
              <td className="num">{r.version}</td>
              <td>
                {r.verificationMethod !== 'test' ? <span className="muted">n/a</span> : covered.has(r.id) ? <Badge kind="ok">covered</Badge> : <Badge kind="err">no test</Badge>}
              </td>
              <td><button onClick={() => setEdit(r)}>Edit</button></td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={9} className="muted">No requirements. Import a CSV/Excel file to get started (an example is in the samples folder).</td></tr>}
        </tbody>
      </table>

      {edit && <RequirementDialog initial={edit} onClose={() => setEdit(null)} />}
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
    </>
  );
}

function RequirementDialog({ initial, onClose }: { initial: Partial<Requirement>; onClose: () => void }) {
  const { apply, data } = useApp();
  const [r, setR] = useState(initial);
  const [standards, setStandards] = useState(
    (initial.standards ?? []).map((s) => (s.clause ? `${s.standard} (${s.clause})` : s.standard)).join('; '),
  );
  const set = <K extends keyof Requirement>(k: K, v: Requirement[K]) => setR((p) => ({ ...p, [k]: v }));
  const parse = (): StandardRef[] =>
    standards.split(/[;\n]/).map((s) => s.trim()).filter(Boolean).map((s) => {
      const m = /^(.*?)\s*\((.*)\)$/.exec(s);
      return m ? { standard: m[1].trim(), clause: m[2].trim() } : { standard: s };
    });
  const save = async () => {
    if (!r.reqId?.trim()) return;
    const ok = await apply(
      window.api.saveRequirement({
        ...(r as Requirement),
        reqId: r.reqId.trim(),
        standards: parse(),
        status: r.status ?? 'active',
      }),
    );
    if (ok) onClose();
  };
  return (
    <Modal
      title={r.id ? `Edit ${r.reqId}` : 'New requirement'}
      onClose={onClose}
      footer={
        <>
          {r.id && (
            <button className="danger" onClick={async () => { if (confirm(`Delete ${r.reqId}? Links from test cases are removed.`) && (await apply(window.api.deleteRequirement(r.id!)))) onClose(); }}>Delete</button>
          )}
          <span className="spacer" />
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!r.reqId?.trim()} onClick={save}>Save</button>
        </>
      }
    >
      <div className="form">
        <Field label="Requirement ID *">{(id) => <input id={id} value={r.reqId ?? ''} onChange={(e) => set('reqId', e.target.value)} />}</Field>
        <Field label="Title">{(id) => <input id={id} value={r.title ?? ''} onChange={(e) => set('title', e.target.value)} />}</Field>
        <Field label="Requirement text" full>{(id) => <textarea id={id} value={r.text ?? ''} onChange={(e) => set('text', e.target.value)} />}</Field>
        <Field label="Type / category">{(id) => <Select id={id} value={r.type ?? 'functional'} options={REQUIREMENT_TYPES} onChange={(v) => set('type', v)} />}</Field>
        <Field label="V-model level">{(id) => <Select id={id} value={r.level ?? 'system'} options={LEVELS} onChange={(v) => set('level', v)} />}</Field>
        <Field label="Verification method">{(id) => <Select id={id} value={r.verificationMethod ?? 'test'} options={VERIFICATION_METHODS} onChange={(v) => set('verificationMethod', v)} />}</Field>
        <Field label="Status">{(id) => <Select id={id} value={r.status ?? 'active'} options={['active', 'obsolete'] as const} onChange={(v) => set('status', v)} />}</Field>
        <Field label="Standards / regulations (separate with ;  clause in brackets)" full>
          {(id) => <>
            <input id={id} list="std-list" value={standards} onChange={(e) => setStandards(e.target.value)} />
            <datalist id="std-list">{STANDARD_SUGGESTIONS.map((s) => <option key={s} value={s} />)}</datalist>
          </>}
        </Field>
      </div>
      {r.id && <p className="muted">Saving a change to title, text or verification method marks linked test cases as suspect. {data.testCases.filter((t) => t.requirementIds.includes(r.id!)).length} test case(s) linked.</p>}
    </Modal>
  );
}

function ImportDialog({ onClose }: { onClose: () => void }) {
  const { setProject, notify } = useApp();
  const [file, setFile] = useState<ImportFileResult | null>(null);
  const [mapping, setMapping] = useState<ImportFileResult['mapping']>({});
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const refresh = async (f: ImportFileResult, m: ImportFileResult['mapping']) => setPreview(await window.api.previewImport(f.table, m));
  const pick = async () => {
    try {
      const f = await window.api.pickImportFile();
      if (!f) return;
      setFile(f);
      setMapping(f.mapping);
      await refresh(f, f.mapping);
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  };
  const commit = async () => {
    if (!file) return;
    try {
      const r = await window.api.commitImport(file.table, mapping);
      setProject(r.project);
      setResult(r.result);
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  };

  return (
    <Modal
      title="Import requirements"
      onClose={onClose}
      footer={
        result ? (
          <button className="primary" onClick={onClose}>Done</button>
        ) : (
          <>
            <button onClick={onClose}>Cancel</button>
            <button className="primary" disabled={!file || mapping.reqId === undefined || !preview?.count} onClick={commit}>
              Import {preview?.count ?? 0} requirements
            </button>
          </>
        )
      }
    >
      {result ? (
        <div>
          <p>Added {result.added.length}, updated {result.updated.length}, unchanged {result.unchanged.length}.</p>
          {result.suspectedTests.length > 0 && (
            <div className="panel">
              <h3>{result.suspectedTests.length} test case(s) are now suspect</h3>
              <ul className="plain">{result.suspectedTests.map((s, i) => <li key={i}>{s.tid}: {s.reason}</li>)}</ul>
            </div>
          )}
          {result.missing.length > 0 && (
            <div className="panel">
              <h3>{result.missing.length} existing requirement(s) not in this file</h3>
              <p className="muted">They were left unchanged: {result.missing.join(', ')}</p>
            </div>
          )}
        </div>
      ) : (
        <>
          <p>
            <button onClick={pick}>{file ? 'Choose another file...' : 'Choose file...'}</button>{' '}
            <span className="muted">{file ? `${file.fileName}: ${file.table.rows.length} rows` : 'CSV or Excel (.xlsx), first row = column headers.'}</span>
          </p>
          {file && (
            <>
              <h3>Map columns</h3>
              <div className="form">
                {(Object.keys(FIELD_LABELS) as FieldKey[]).map((f) => (
                  <Field key={f} label={FIELD_LABELS[f]}>
                    {(id) => (
                      <select
                        id={id}
                        value={mapping[f] ?? ''}
                        onChange={(e) => {
                          const next = { ...mapping };
                          if (e.target.value === '') delete next[f];
                          else next[f] = Number(e.target.value);
                          setMapping(next);
                          void refresh(file, next);
                        }}
                      >
                        <option value="">(not mapped)</option>
                        {file.table.headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                      </select>
                    )}
                  </Field>
                ))}
              </div>
              {preview && (
                <div className="panel" style={{ marginTop: 12 }}>
                  <b>{preview.count}</b> requirements: {preview.newCount} new, {preview.changedCount} changed.
                  {preview.issues.length > 0 && (
                    <ul className="plain issue-warning">{preview.issues.slice(0, 15).map((i, n) => <li key={n}>Row {i.row}: {i.message}</li>)}</ul>
                  )}
                </div>
              )}
              <h3>First rows</h3>
              <table className="grid">
                <thead><tr>{file.table.headers.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
                <tbody>{file.table.rows.slice(0, 5).map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
              </table>
            </>
          )}
        </>
      )}
    </Modal>
  );
}
