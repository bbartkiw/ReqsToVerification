import { useMemo, useState } from 'react';
import { coverage, traceabilityMatrix, type CoverageBucket } from '../../core/analysis';
import { Bar, Badge, pct, useApp } from '../ui';

function Buckets({ title, items }: { title: string; items: CoverageBucket[] }) {
  return (
    <div className="panel">
      <h3>{title}</h3>
      <table className="grid">
        <tbody>
          {items.map((b) => (
            <tr key={b.key}>
              <td>{b.key}</td>
              <td className="num">{b.covered}/{b.total}</td>
              <td style={{ width: 160 }}><Bar value={pct(b.covered, b.total)} /></td>
            </tr>
          ))}
          {items.length === 0 && <tr><td className="muted">No data.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export function Dashboard() {
  const { data } = useApp();
  const [view, setView] = useState<'coverage' | 'matrix'>('coverage');
  const cov = useMemo(() => coverage(data), [data]);
  const matrix = useMemo(() => traceabilityMatrix(data), [data]);

  return (
    <>
      <div className="toolbar">
        <button aria-pressed={view === 'coverage'} onClick={() => setView('coverage')} className={view === 'coverage' ? 'primary' : ''}>Coverage</button>
        <button aria-pressed={view === 'matrix'} onClick={() => setView('matrix')} className={view === 'matrix' ? 'primary' : ''}>Traceability matrix</button>
      </div>

      {view === 'coverage' ? (
        <>
          <div className="kpis">
            <div className="kpi"><div className="muted">Requirements</div><div className="v">{data.requirements.length}</div></div>
            <div className="kpi"><div className="muted">Verified by test</div><div className="v">{cov.verifiable}</div></div>
            <div className="kpi"><div className="muted">Covered by a test case</div><div className="v">{cov.percent}%</div><Bar value={cov.percent} /></div>
            <div className="kpi"><div className="muted">Test cases</div><div className="v">{data.testCases.length}</div></div>
            <div className="kpi"><div className="muted">Suspect tests</div><div className="v" style={{ color: cov.suspectTests.length ? 'var(--warn)' : undefined }}>{cov.suspectTests.length}</div></div>
          </div>
          <div className="kpis" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', alignItems: 'start' }}>
            <Buckets title="Coverage by type" items={cov.byType} />
            <Buckets title="Coverage by V-model level" items={cov.byLevel} />
            <Buckets title="Coverage by standard / regulation" items={cov.byStandard} />
          </div>
          <div className="panel">
            <h3>Requirements without a test case ({cov.uncovered.length})</h3>
            {cov.uncovered.length === 0 ? <p className="muted">None.</p> : (
              <ul className="plain">{cov.uncovered.map((r) => <li key={r.id}><b>{r.reqId}</b> {r.title} <Badge>{r.type}</Badge></li>)}</ul>
            )}
          </div>
          <div className="panel">
            <h3>Test cases without a requirement ({cov.orphanTests.length})</h3>
            {cov.orphanTests.length === 0 ? <p className="muted">None.</p> : (
              <ul className="plain">{cov.orphanTests.map((t) => <li key={t.id}><b>{t.tid}</b> {t.title}</li>)}</ul>
            )}
          </div>
          <div className="panel">
            <h3>Suspect test cases ({cov.suspectTests.length})</h3>
            {cov.suspectTests.length === 0 ? <p className="muted">None.</p> : (
              <ul className="plain">{cov.suspectTests.map((t) => <li key={t.id}><b>{t.tid}</b> {t.title}: {t.suspectReason}</li>)}</ul>
            )}
          </div>
        </>
      ) : (
        <div style={{ overflow: 'auto' }}>
          <table className="grid matrix">
            <thead>
              <tr><th>Requirement</th>{matrix.tests.map((t) => <th key={t.id} title={t.title}>{t.tid}</th>)}</tr>
            </thead>
            <tbody>
              {matrix.requirements.map((r) => (
                <tr key={r.id}>
                  <td title={r.title}>{r.reqId} <span className="muted">{r.title}</span></td>
                  {matrix.tests.map((t) => <td key={t.id}>{matrix.links.has(`${r.id}|${t.id}`) ? <span aria-label="linked">X</span> : ''}</td>)}
                </tr>
              ))}
              {matrix.requirements.length === 0 && <tr><td className="muted">No requirements.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
