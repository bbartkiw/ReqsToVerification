import type { Equipment, EquipmentKind, EquipmentStatus, ProjectData } from './types';

/** Normalise a free-text need so "Climate chamber" and "climate chamber (standard equipment)" match. */
export const needKey = (s: string): string => s.replace(/\s*\(standard equipment\)\s*$/i, '').trim().toLowerCase();

export interface ProposedEquipment {
  /** Normalised need, used to link tests afterwards. */
  key: string;
  name: string;
  kind: EquipmentKind;
  category: string;
  status: EquipmentStatus;
  testCaseIds: string[];
  requirementIds: string[];
  /** Set when the catalogue already has an item with this name: it is linked, not duplicated. */
  existingEquipmentId?: string;
}

const CATEGORY_RULES: [RegExp, string][] = [
  [/chamber|climat|humid|ingress|ip\b|dust|water/i, 'Environmental'],
  [/vibr|shock|drop/i, 'Mechanical'],
  [/emc|emi|esd|lisn|antenna|receiver/i, 'EMC'],
  [/oscillo|scope|timer|counter|logic/i, 'Measurement'],
  [/supply|multimeter|dmm|power/i, 'Power'],
  [/bus|protocol|analyser|analyzer|ethernet|can\b/i, 'Communication'],
  [/fault|safety|e-?stop/i, 'Safety'],
  [/life|endurance|burn/i, 'Reliability'],
];

export const guessCategory = (need: string): string => CATEGORY_RULES.find(([re]) => re.test(need))?.[1] ?? 'General';

/** Fixtures, rigs and jigs are built in-house; instruments are bought or hired. */
export const guessKind = (need: string): EquipmentKind => (/fixture|\brig\b|\bjig\b|custom|bench/i.test(need) ? 'company' : 'standard');

/**
 * Equipment that tests (optionally limited to some plans) need but the catalogue does not hold.
 */
export function proposeEquipment(d: ProjectData, planIds?: string[]): ProposedEquipment[] {
  const ids = planIds?.length
    ? new Set(d.plans.filter((p) => planIds.includes(p.id)).flatMap((p) => p.items.map((i) => i.testCaseId)))
    : null;
  const byKey = new Map<string, ProposedEquipment>();
  for (const t of d.testCases) {
    if (t.status === 'obsolete' || (ids && !ids.has(t.id))) continue;
    for (const raw of t.missingEquipment ?? []) {
      const key = needKey(raw);
      if (!key) continue;
      const name = raw.replace(/\s*\(standard equipment\)\s*$/i, '').trim();
      const kind = guessKind(name);
      const p =
        byKey.get(key) ??
        ({
          key,
          name: name.charAt(0).toUpperCase() + name.slice(1),
          kind,
          category: guessCategory(name),
          status: kind === 'company' ? 'to_be_built' : 'to_procure',
          testCaseIds: [],
          requirementIds: [],
          existingEquipmentId: d.equipment.find((e: Equipment) => e.name.trim().toLowerCase() === key)?.id,
        } satisfies ProposedEquipment);
      p.testCaseIds.push(t.id);
      for (const r of t.requirementIds) if (!p.requirementIds.includes(r)) p.requirementIds.push(r);
      byKey.set(key, p);
    }
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
}
