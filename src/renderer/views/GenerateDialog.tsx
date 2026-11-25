import { useMemo, useState } from 'react';
import {
  DEFAULT_OPTIONS,
  generateTestCases,
  selectRequirements,
  type EquipmentPreference,
  type GenerateOptions,
  type GenerationScope,
  type GroupingStrategy,
} from '../../core/generate';
import { Badge, Field, Modal, Select, useApp } from '../ui';

const GROUPING_LABELS: Record<GroupingStrategy, string> = {
  'per-requirement': 'One test per requirement (1:1)',
  'by-type': 'Group requirements of the same type (N:1)',
  'by-type-level': 'Group by type and V-model level (N:1)',
  'by-standard': 'Group by standard / regulation (N:1)',
  'by-equipment': 'Group by shared equipment set-up (N:1)',
};
const PREF_LABELS: Record<EquipmentPreference, string> = {
  any: 'Any equipment (prefer standard)',
  standard: 'Standard equipment only',
  company: 'Prefer company-specific equipment',
};

export function GenerateDialog({
  onClose,
  requirementIds,
}: {
  onClose: () => void;
  /** When given, offers "selected requirements" as the generation scope. */
  requirementIds?: string[];
}) {
  const { data, apply, notify } = useApp();
  const [opts, setOpts] = useState<GenerateOptions>({
    ...DEFAULT_OPTIONS,
    scope: requirementIds?.length ? 'selected' : 'uncovered',
    requirementIds,
  });
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [planName, setPlanName] = useState('');
  const [busy, setBusy] = useState(false);

  const update = (patch: Partial<GenerateOptions>) => {
    setOpts((o) => ({ ...o, ...patch }));
    setExcluded(new Set());
  };
  const proposals = useMemo(() => generateTestCases(data, opts), [data, opts]);
  const reqCount = useMemo(() => selectRequirements(data, opts).length, [data, opts]);
  const chosen = proposals.filter((p) => !excluded.has(p.key));
  const reqLabel = (id: string) => data.requirements.find((r) => r.id === id)?.reqId ?? '?';
  const eq = (id: string) => data.equipment.find((e) => e.id === id);
  const toggle = (key: string) =>
    setExcluded((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  const create = async () => {
    setBusy(true);
    const ok = await apply(window.api.createGeneratedTests(chosen, planName.trim() || undefined));
    setBusy(false);
    if (ok) {
      notify(`Created ${chosen.length} draft test case(s)${planName.trim() ? ` and plan "${planName.trim()}"` : ''}. Review them under Test cases.`);
      onClose();
    }
  };

  const scopes: GenerationScope[] = requirementIds?.length ? ['selected', 'uncovered', 'all-verifiable'] : ['uncovered', 'all-verifiable'];
  const SCOPE_LABELS: Record<GenerationScope, string> = {
    uncovered: 'Requirements without a test case',
    'all-verifiable': 'All requirements verified by test',
    selected: `The ${requirementIds?.length ?? 0} requirements in the current filter`,
  };

  return (
    <Modal
      title="Generate test cases from requirements"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={chosen.length === 0 || busy} onClick={create}>
            Create {chosen.length} draft test case{chosen.length === 1 ? '' : 's'}
          </button>
        </>
      }
    >
      <div className="form">
        <Field label="Generate for">{(id) => <Select id={id} value={opts.scope} options={scopes} labels={SCOPE_LABELS} onChange={(v) => update({ scope: v })} />}</Field>
        <Field label="Grouping (many requirements into one test, or one each)">
          {(id) => <Select id={id} value={opts.grouping} options={Object.keys(GROUPING_LABELS) as GroupingStrategy[]} labels={GROUPING_LABELS} onChange={(v) => update({ grouping: v })} />}
        </Field>
        <Field label="Equipment focus">
          {(id) => <Select id={id} value={opts.equipmentPreference} options={['any', 'standard', 'company'] as const} labels={PREF_LABELS} onChange={(v) => update({ equipmentPreference: v })} />}
        </Field>
        <Field label="Max requirements per grouped test">
          {(id) => <input id={id} type="number" min={1} max={50} value={opts.maxRequirementsPerTest} onChange={(e) => update({ maxRequirementsPerTest: Math.max(1, Number(e.target.value) || 1) })} />}
        </Field>
        <div className="field full">
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', color: 'inherit', fontSize: 14 }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={opts.splitCases} onChange={(e) => update({ splitCases: e.target.checked })} />
            Split a requirement into several tests (nominal, boundary / limits, off-nominal) where it makes sense (1:N)
          </label>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 12 }}>
        <b>{reqCount}</b> requirement(s) in scope produce <b>{proposals.length}</b> proposed test case(s).
        Generated tests are drafts built from templates by requirement type, with limits taken from the requirement text. Review and refine them before use.
      </div>

      {proposals.length === 0 && <p className="muted">Nothing to generate. Import requirements with verification method "test", or change the scope.</p>}

      {proposals.map((p) => (
        <div className="panel" key={p.key} style={excluded.has(p.key) ? { opacity: 0.5 } : undefined}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', color: 'inherit', fontSize: 14 }}>
            <input type="checkbox" style={{ width: 'auto', marginTop: 4 }} checked={!excluded.has(p.key)} onChange={() => toggle(p.key)} aria-label={`Include ${p.title}`} />
            <span>
              <b>{p.title}</b>
              <br />
              {p.requirementIds.map((r) => <Badge key={r}>{reqLabel(r)}</Badge>)}
              {p.equipmentIds.map((e) => <Badge key={e} kind={eq(e)?.kind === 'company' ? 'company' : 'ok'}>{eq(e)?.name}</Badge>)}
              {p.missingEquipment.map((m) => <Badge key={m} kind="warn">needs: {m}</Badge>)}
              <span className="muted"> ~{p.estimatedMinutes} min. {p.rationale}</span>
            </span>
          </label>
          <details>
            <summary>Steps and criteria</summary>
            <ol>
              {p.steps.map((s, i) => <li key={i}>{s.action} <span className="muted">Expected: {s.expected}</span></li>)}
            </ol>
            <p><b>Pass criteria:</b> {p.passCriteria}</p>
            <p><b>Environment:</b> {p.environment}</p>
          </details>
        </div>
      ))}

      <Field label="Also create a test plan with these tests (optional, name)" full>
        {(id) => <input id={id} value={planName} placeholder="e.g. System verification plan v1" onChange={(e) => setPlanName(e.target.value)} />}
      </Field>
    </Modal>
  );
}
