import { useMemo, useState } from 'react';
import { proposeEquipment, type ProposedEquipment } from '../../core/equipmentGen';
import { EQUIPMENT_KINDS, type EquipmentKind } from '../../core/types';
import { Badge, Modal, Select, useApp } from '../ui';

/** Creates catalogue entries for equipment that test plans need but the catalogue lacks. */
export function EquipmentGenDialog({ onClose, planId }: { onClose: () => void; planId?: string }) {
  const { data, apply, notify } = useApp();
  const [scope, setScope] = useState<string>(planId ?? 'all');
  const base = useMemo(() => proposeEquipment(data, scope === 'all' ? undefined : [scope]), [data, scope]);
  const [edits, setEdits] = useState<Record<string, Partial<ProposedEquipment>>>({});
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const items = base.map((p) => ({ ...p, ...edits[p.key] }));
  const chosen = items.filter((p) => !excluded.has(p.key));
  const patch = (key: string, v: Partial<ProposedEquipment>) => setEdits((e) => ({ ...e, [key]: { ...e[key], ...v } }));
  const tid = (id: string) => data.testCases.find((t) => t.id === id)?.tid ?? '?';

  const create = async () => {
    setBusy(true);
    const ok = await apply(
      window.api.createEquipmentFromNeeds(
        chosen.map((p) => ({ ...p, status: p.kind === 'company' ? 'to_be_built' : 'to_procure' })),
      ),
    );
    setBusy(false);
    if (ok) {
      notify(`Added ${chosen.filter((c) => !c.existingEquipmentId).length} equipment item(s) to the catalogue and linked them to the test cases.`);
      onClose();
    }
  };

  return (
    <Modal
      title="Generate equipment from test plans"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={chosen.length === 0 || busy} onClick={create}>
            Add {chosen.length} item{chosen.length === 1 ? '' : 's'} to the catalogue
          </button>
        </>
      }
    >
      <div className="toolbar">
        <label htmlFor="eqgen-scope">Plans:</label>
        <select id="eqgen-scope" value={scope} onChange={(e) => { setScope(e.target.value); setExcluded(new Set()); setEdits({}); }}>
          <option value="all">All test cases</option>
          {data.plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <p className="muted">
        Lists equipment that tests need but the catalogue does not have yet. Added items are marked "to be built" (company-specific fixtures and rigs)
        or "to be procured" (standard instruments). Linked tests are updated. Complete model, serial and calibration data afterwards.
      </p>
      {items.length === 0 ? (
        <p>Nothing to add. Generate test cases first, or all needed equipment is already in the catalogue.</p>
      ) : (
        <table className="grid">
          <thead><tr><th /><th>Equipment</th><th>Kind</th><th>Category</th><th>Needed by</th></tr></thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.key} style={excluded.has(p.key) ? { opacity: 0.5 } : undefined}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Include ${p.name}`}
                    checked={!excluded.has(p.key)}
                    onChange={() => setExcluded((s) => { const n = new Set(s); if (n.has(p.key)) n.delete(p.key); else n.add(p.key); return n; })}
                  />
                </td>
                <td>
                  <input aria-label={`Name of ${p.name}`} value={p.name} disabled={!!p.existingEquipmentId} onChange={(e) => patch(p.key, { name: e.target.value })} />
                  {p.existingEquipmentId && <Badge kind="ok">already in catalogue: will only link</Badge>}
                </td>
                <td style={{ width: 160 }}>
                  <Select value={p.kind} options={EQUIPMENT_KINDS} labels={{ standard: 'Standard', company: 'Company-specific' }} onChange={(v: EquipmentKind) => patch(p.key, { kind: v })} />
                </td>
                <td style={{ width: 150 }}>
                  <input aria-label={`Category of ${p.name}`} value={p.category} onChange={(e) => patch(p.key, { category: e.target.value })} />
                </td>
                <td>{p.testCaseIds.map((id) => <Badge key={id}>{tid(id)}</Badge>)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}
