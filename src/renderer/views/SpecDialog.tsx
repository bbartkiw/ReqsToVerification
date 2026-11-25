import { useMemo, useState } from 'react';
import { analysePlan } from '../../core/analysis';
import { DEFAULT_SPEC_OPTIONS } from '../../core/specification';
import type { TestPlan } from '../../core/types';
import { Field, Modal, Select, useApp } from '../ui';

/** Exports the test specification document for a plan as PDF or Word. */
export function SpecDialog({ plan, onClose }: { plan: TestPlan; onClose: () => void }) {
  const { data, notify } = useApp();
  const [format, setFormat] = useState<'docx' | 'pdf'>('docx');
  const [documentId, setDocumentId] = useState('');
  const [author, setAuthor] = useState('');
  const [includeResultColumns, setResults] = useState(DEFAULT_SPEC_OPTIONS.includeResultColumns);
  const [includeTraceability, setTrace] = useState(DEFAULT_SPEC_OPTIONS.includeTraceability);
  const [busy, setBusy] = useState(false);
  const report = useMemo(() => analysePlan(data, plan), [data, plan]);
  const open = report.issues.filter((i) => i.severity !== 'info');

  const run = async () => {
    setBusy(true);
    try {
      const path = await window.api.exportSpecification(plan.id, format, { documentId, author, includeResultColumns, includeTraceability });
      if (path) {
        notify(`Test specification exported to ${path}`);
        onClose();
      }
    } catch (e) {
      notify((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Test specification: ${plan.name}`}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={run} disabled={busy || report.tests.length === 0}>Generate specification</button>
        </>
      }
    >
      <p>
        Builds a test specification document from the saved plan: introduction and scope, reference standards, required equipment and environment,
        test case overview, detailed test procedures, and requirements traceability. Save plan changes first.
      </p>
      <div className="form">
        <Field label="Format">{(id) => <Select id={id} value={format} options={['docx', 'pdf'] as const} labels={{ docx: 'Word (.docx), editable', pdf: 'PDF' }} onChange={setFormat} />}</Field>
        <Field label="Document ID (blank = automatic)">{(id) => <input id={id} value={documentId} onChange={(e) => setDocumentId(e.target.value)} placeholder="e.g. TS-0001" />}</Field>
        <Field label="Author">{(id) => <input id={id} value={author} onChange={(e) => setAuthor(e.target.value)} />}</Field>
        <div className="field full">
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', color: 'inherit', fontSize: 14 }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={includeResultColumns} onChange={(e) => setResults(e.target.checked)} />
            Add actual-result and pass/fail columns and a sign-off line to each test (usable as execution record)
          </label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', color: 'inherit', fontSize: 14, marginTop: 6 }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={includeTraceability} onChange={(e) => setTrace(e.target.checked)} />
            Include requirements traceability section
          </label>
        </div>
      </div>
      <div className="panel" style={{ marginTop: 12 }}>
        <b>{report.tests.length}</b> test case(s), <b>{report.coveredRequirementIds.length}</b> requirement(s).
        {report.tests.length === 0 && <span className="issue-error"> Add test cases to the plan first.</span>}
        {open.length > 0 && (
          <>
            <p className="issue-warning">The document will list these open points on its first page:</p>
            <ul className="plain">{open.slice(0, 8).map((i, n) => <li key={n} className={`issue-${i.severity}`}>{i.message}</li>)}{open.length > 8 && <li>and {open.length - 8} more</li>}</ul>
          </>
        )}
      </div>
    </Modal>
  );
}
