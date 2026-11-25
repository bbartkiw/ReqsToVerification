import { useState } from 'react';
import { calibrationState } from '../../core/analysis';
import { EQUIPMENT_KINDS, EQUIPMENT_STATUSES, type Equipment } from '../../core/types';
import { Badge, Field, Modal, Select, useApp } from '../ui';
import { EquipmentGenDialog } from './EquipmentGenDialog';

const KIND_LABELS = { standard: 'Standard', company: 'Company-specific' } as const;

const blank = (): Partial<Equipment> => ({
  name: '', kind: 'standard', category: '', model: '', serial: '', calibrationDue: '', status: 'available', notes: '',
});

export function EquipmentView() {
  const { data } = useApp();
  const [kind, setKind] = useState('');
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<Partial<Equipment> | null>(null);
  const [generating, setGenerating] = useState(false);
  const now = new Date();
  const rows = data.equipment.filter(
    (e) => (!kind || e.kind === kind) && `${e.name} ${e.category} ${e.model} ${e.serial}`.toLowerCase().includes(q.toLowerCase()),
  );
  const usage = (id: string) => data.testCases.filter((t) => t.equipmentIds.includes(id)).length;

  return (
    <>
      <div className="toolbar">
        <input type="search" placeholder="Search equipment..." aria-label="Search equipment" value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="Filter by kind" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">Standard + company-specific</option>
          <option value="standard">Standard only</option>
          <option value="company">Company-specific only</option>
        </select>
        <span className="spacer" />
        <button className="primary" onClick={() => setGenerating(true)}>Generate from test plans...</button>
        <button onClick={() => setEdit(blank())}>New equipment</button>
      </div>
      <table className="grid">
        <thead><tr><th>Name</th><th>Kind</th><th>Category</th><th>Model / serial</th><th>Calibration</th><th>Status</th><th className="num">Tests</th><th /></tr></thead>
        <tbody>
          {rows.map((e) => {
            const cal = calibrationState(e, now);
            return (
              <tr key={e.id}>
                <td>{e.name}</td>
                <td><Badge kind={e.kind === 'company' ? 'company' : undefined}>{KIND_LABELS[e.kind]}</Badge></td>
                <td>{e.category}</td>
                <td>{e.model} {e.serial && <span className="muted">#{e.serial}</span>}</td>
                <td>
                  {cal === 'none' ? <span className="muted">not required</span> : <Badge kind={cal === 'ok' ? 'ok' : cal === 'due-soon' ? 'warn' : 'err'}>{e.calibrationDue}{cal === 'expired' ? ' (expired)' : cal === 'due-soon' ? ' (due soon)' : ''}</Badge>}
                </td>
                <td><Badge kind={e.status === 'available' ? 'ok' : e.status === 'in_repair' ? 'err' : 'warn'}>{e.status.replace(/_/g, ' ')}</Badge></td>
                <td className="num">{usage(e.id)}</td>
                <td><button onClick={() => setEdit(e)}>Edit</button></td>
              </tr>
            );
          })}
          {rows.length === 0 && <tr><td colSpan={8} className="muted">No equipment yet. Add standard instruments and company-specific rigs or fixtures.</td></tr>}
        </tbody>
      </table>
      {edit && <EquipmentDialog initial={edit} onClose={() => setEdit(null)} />}
      {generating && <EquipmentGenDialog onClose={() => setGenerating(false)} />}
    </>
  );
}

function EquipmentDialog({ initial, onClose }: { initial: Partial<Equipment>; onClose: () => void }) {
  const { apply } = useApp();
  const [e, setE] = useState(initial);
  const set = <K extends keyof Equipment>(k: K, v: Equipment[K]) => setE((p) => ({ ...p, [k]: v }));
  return (
    <Modal
      title={e.id ? `Edit ${e.name}` : 'New equipment'}
      onClose={onClose}
      footer={
        <>
          {e.id && <button className="danger" onClick={async () => { if (confirm(`Delete ${e.name}? It is removed from test cases.`) && (await apply(window.api.deleteEquipment(e.id!)))) onClose(); }}>Delete</button>}
          <span className="spacer" />
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!e.name?.trim()} onClick={async () => { if (await apply(window.api.saveEquipment(e as Equipment))) onClose(); }}>Save</button>
        </>
      }
    >
      <div className="form">
        <Field label="Name *">{(id) => <input id={id} value={e.name ?? ''} onChange={(x) => set('name', x.target.value)} />}</Field>
        <Field label="Kind">{(id) => <Select id={id} value={e.kind ?? 'standard'} options={EQUIPMENT_KINDS} labels={KIND_LABELS} onChange={(v) => set('kind', v)} />}</Field>
        <Field label="Category (oscilloscope, climate chamber, fixture...)">{(id) => <input id={id} value={e.category ?? ''} onChange={(x) => set('category', x.target.value)} />}</Field>
        <Field label="Status">{(id) => <Select id={id} value={e.status ?? 'available'} options={EQUIPMENT_STATUSES} labels={{ available: 'available', in_repair: 'in repair', to_be_built: 'to be built', to_procure: 'to be procured' }} onChange={(v) => set('status', v)} />}</Field>
        <Field label="Model">{(id) => <input id={id} value={e.model ?? ''} onChange={(x) => set('model', x.target.value)} />}</Field>
        <Field label="Serial / asset number">{(id) => <input id={id} value={e.serial ?? ''} onChange={(x) => set('serial', x.target.value)} />}</Field>
        <Field label="Calibration due (blank if not required)">{(id) => <input id={id} type="date" value={e.calibrationDue ?? ''} onChange={(x) => set('calibrationDue', x.target.value)} />}</Field>
        <Field label="Notes" full>{(id) => <textarea id={id} value={e.notes ?? ''} onChange={(x) => set('notes', x.target.value)} />}</Field>
      </div>
    </Modal>
  );
}
