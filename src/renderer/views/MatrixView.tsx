import { useMemo, useState } from 'react';
import { traceabilityMatrix } from '../../core/analysis';
import { REQUIREMENT_TYPES, type Requirement, type TestCase } from '../../core/types';
import { useApp, useTooltip } from '../ui';

const standardsText = (r: Requirement): string =>
  r.standards.map((s) => (s.clause ? `${s.standard} (${s.clause})` : s.standard)).join('; ');

/** Requirement x test case matrix. IDs are shown; details appear on hover or keyboard focus. */
export function MatrixView() {
  const { data } = useApp();
  const matrix = useMemo(() => traceabilityMatrix(data), [data]);
  const tip = useTooltip();
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [onlyGaps, setOnlyGaps] = useState(false);
  const [hover, setHover] = useState<{ r?: string; t?: string }>({});

  const rows = matrix.requirements.filter((r) => {
    if (type && r.type !== type) return false;
    if (q && !`${r.reqId} ${r.title} ${r.text}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (onlyGaps) return r.verificationMethod === 'test' && !matrix.tests.some((t) => matrix.links.has(`${r.id}|${t.id}`));
    return true;
  });
  const linkedCount = (r: Requirement) => matrix.tests.filter((t) => matrix.links.has(`${r.id}|${t.id}`)).length;
  const testReqCount = (t: TestCase) => t.requirementIds.length;

  const reqTip = (r: Requirement) => (
    <>
      <div className="tt-id">{r.reqId}: {r.title}</div>
      <div>{r.text || <i>(no requirement text)</i>}</div>
      <div className="tt-meta">
        {r.type} | {r.level} | verified by {r.verificationMethod}
        {r.standards.length > 0 && <> | {standardsText(r)}</>}
        {' | '}{linkedCount(r)} test case(s)
      </div>
    </>
  );
  const testTip = (t: TestCase) => (
    <>
      <div className="tt-id">{t.tid}: {t.title}</div>
      {t.objective && <div>{t.objective}</div>}
      <div className="tt-meta">
        {t.status}{t.suspect ? ' | SUSPECT' : ''} | verifies {testReqCount(t)} requirement(s)
      </div>
    </>
  );

  const reqEvents = (r: Requirement) => ({
    tabIndex: 0,
    onMouseEnter: (e: React.MouseEvent) => { tip.show(e.currentTarget, reqTip(r)); setHover({ r: r.id }); },
    onFocus: (e: React.FocusEvent) => { tip.show(e.currentTarget, reqTip(r)); setHover({ r: r.id }); },
    onMouseLeave: () => { tip.hide(); setHover({}); },
    onBlur: () => { tip.hide(); setHover({}); },
  });
  const testEvents = (t: TestCase) => ({
    tabIndex: 0,
    onMouseEnter: (e: React.MouseEvent) => { tip.show(e.currentTarget, testTip(t)); setHover({ t: t.id }); },
    onFocus: (e: React.FocusEvent) => { tip.show(e.currentTarget, testTip(t)); setHover({ t: t.id }); },
    onMouseLeave: () => { tip.hide(); setHover({}); },
    onBlur: () => { tip.hide(); setHover({}); },
  });

  return (
    <>
      <div className="toolbar">
        <input type="search" placeholder="Filter requirements..." aria-label="Filter requirements in matrix" value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="Filter matrix by type" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All types</option>
          {REQUIREMENT_TYPES.map((t) => <option key={t}>{t}</option>)}
        </select>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={onlyGaps} onChange={(e) => setOnlyGaps(e.target.checked)} />
          Only requirements without a test
        </label>
        <span className="spacer" />
        <span className="muted">{rows.length} requirements x {matrix.tests.length} test cases. Hover or focus an ID for details. Red bar = verified by test but no test case.</span>
      </div>

      <div className="matrix-wrap">
        <table className="matrix">
          <caption className="muted" style={{ display: 'none' }}>Traceability matrix of requirements and test cases</caption>
          <thead>
            <tr>
              <th className="corner" scope="col">Requirement</th>
              {matrix.tests.map((t) => (
                <th key={t.id} scope="col" className={hover.t === t.id ? 'hlc' : ''} {...testEvents(t)}>{t.tid}{t.suspect ? ' !' : ''}</th>
              ))}
              <th scope="col">#</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const n = linkedCount(r);
              return (
                <tr key={r.id} className={`${hover.r === r.id ? 'hl' : ''}${n === 0 && r.verificationMethod === 'test' ? ' nolink' : ''}`}>
                  <th scope="row" className="rowhead" {...reqEvents(r)}>{r.reqId}</th>
                  {matrix.tests.map((t) => {
                    const linked = matrix.links.has(`${r.id}|${t.id}`);
                    return (
                      <td
                        key={t.id}
                        className={`${linked ? 'link' : ''}${hover.t === t.id ? ' hlc' : ''}`}
                        onMouseEnter={(e) => {
                          setHover({ r: r.id, t: t.id });
                          if (linked) tip.show(e.currentTarget, <><div className="tt-id">{r.reqId} is verified by {t.tid}</div><div>{r.title}</div><div className="tt-meta">{t.title}</div></>);
                        }}
                        onMouseLeave={() => { tip.hide(); setHover({}); }}
                      >
                        {linked ? <span aria-label={`${r.reqId} verified by ${t.tid}`}>●</span> : ''}
                      </td>
                    );
                  })}
                  <td className="total">{n}</td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><th scope="row" className="rowhead muted">No requirements to show.</th></tr>}
          </tbody>
        </table>
      </div>
      {tip.node}
    </>
  );
}
