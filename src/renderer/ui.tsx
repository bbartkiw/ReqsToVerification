import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { ProjectData } from '../core/types';
import type { ProjectInfo } from '../shared/api';

interface Ctx {
  data: ProjectData;
  path: string;
  /** Run an API call that returns the updated project, surfacing errors. */
  apply: (p: Promise<ProjectInfo>) => Promise<boolean>;
  setProject: (p: ProjectInfo) => void;
  notify: (msg: string, kind?: 'error' | 'info') => void;
}

export const AppCtx = createContext<Ctx>(null as unknown as Ctx);
export const useApp = (): Ctx => useContext(AppCtx);

export function Modal(props: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog ref={ref} onCancel={(e) => { e.preventDefault(); props.onClose(); }} aria-label={props.title}>
      <div className="dlg-head">{props.title}</div>
      <div className="dlg-body">{props.children}</div>
      <div className="dlg-foot">
        {props.footer ?? <button onClick={props.onClose}>Close</button>}
      </div>
    </dialog>
  );
}

export function Field(props: { label: string; children: (id: string) => ReactNode; full?: boolean }) {
  const id = useId();
  return (
    <div className={`field${props.full ? ' full' : ''}`}>
      <label htmlFor={id}>{props.label}</label>
      {props.children(id)}
    </div>
  );
}

export function Select<T extends string>(props: {
  id?: string;
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
  labels?: Partial<Record<T, string>>;
}) {
  return (
    <select id={props.id} value={props.value} onChange={(e) => props.onChange(e.target.value as T)}>
      {props.options.map((o) => (
        <option key={o} value={o}>
          {props.labels?.[o] ?? o}
        </option>
      ))}
    </select>
  );
}

export function MultiPicker(props: {
  label: string;
  items: { id: string; label: string; sub?: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [q, setQ] = useState('');
  const sel = new Set(props.selected);
  const shown = props.items.filter((i) => `${i.label} ${i.sub ?? ''}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="field full">
      <span className="lbl">
        {props.label} ({props.selected.length} selected)
      </span>
      <input type="search" placeholder="Filter..." aria-label={`Filter ${props.label}`} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="picker" role="group" aria-label={props.label}>
        {shown.length === 0 && <span className="muted">Nothing to show.</span>}
        {shown.map((i) => (
          <label key={i.id}>
            <input
              type="checkbox"
              checked={sel.has(i.id)}
              onChange={(e) => {
                const next = new Set(sel);
                if (e.target.checked) next.add(i.id);
                else next.delete(i.id);
                props.onChange([...next]);
              }}
            />
            <span>
              <b>{i.label}</b> {i.sub && <span className="muted">{i.sub}</span>}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

/**
 * Hover / focus tooltip rendered at fixed position, so it is not clipped by
 * scrolling tables. Attach `show`/`hide` to mouse and focus events.
 */
export function useTooltip() {
  const [tip, setTip] = useState<{ x: number; y: number; above: boolean; content: ReactNode } | null>(null);
  const show = (el: Element, content: ReactNode) => {
    const r = el.getBoundingClientRect();
    const above = r.bottom > window.innerHeight - 220;
    setTip({
      x: Math.max(8, Math.min(r.left, window.innerWidth - 440)),
      y: above ? r.top - 6 : r.bottom + 6,
      above,
      content,
    });
  };
  const hide = () => setTip(null);
  const node = tip && (
    <div
      role="tooltip"
      className="tooltip"
      style={{ left: tip.x, top: tip.y, transform: tip.above ? 'translateY(-100%)' : undefined }}
    >
      {tip.content}
    </div>
  );
  return { show, hide, node };
}

export const Badge = (props: { kind?: 'ok' | 'warn' | 'err' | 'company'; children: ReactNode }) => (
  <span className={`badge ${props.kind ?? ''}`}>{props.children}</span>
);

export const pct = (covered: number, total: number): number => (total === 0 ? 100 : Math.round((covered / total) * 100));

export function Bar({ value }: { value: number }) {
  return (
    <div className="bar" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${value}%` }} />
    </div>
  );
}
