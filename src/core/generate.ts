import { coveredRequirementIds } from './analysis';
import type { Equipment, ProjectData, Requirement, RequirementType, TestStep } from './types';

// ---------- Options & output ----------

export type GroupingStrategy =
  | 'per-requirement' // 1 requirement -> 1 test (or several with splitCases)
  | 'by-type' // many requirements of the same type -> 1 test
  | 'by-type-level' // same type and V-model level
  | 'by-standard' // same primary standard / regulation
  | 'by-equipment'; // same equipment need, so one rig setup verifies many requirements

export type EquipmentPreference = 'any' | 'standard' | 'company';
export type GenerationScope = 'uncovered' | 'all-verifiable' | 'selected';

export interface GenerateOptions {
  scope: GenerationScope;
  /** Used when scope is "selected". */
  requirementIds?: string[];
  grouping: GroupingStrategy;
  /** Create extra boundary / off-nominal tests for a requirement (1 requirement -> many tests). */
  splitCases: boolean;
  equipmentPreference: EquipmentPreference;
  /** Upper bound on requirements per grouped test case. */
  maxRequirementsPerTest: number;
}

export const DEFAULT_OPTIONS: GenerateOptions = {
  scope: 'uncovered',
  grouping: 'per-requirement',
  splitCases: false,
  equipmentPreference: 'any',
  maxRequirementsPerTest: 5,
};

export interface ProposedTest {
  /** Stable key within one generation run, used for selection in the UI. */
  key: string;
  title: string;
  objective: string;
  preconditions: string;
  steps: TestStep[];
  passCriteria: string;
  environment: string;
  requirementIds: string[];
  equipmentIds: string[];
  /** Instruments the test needs that are not in the equipment catalogue. */
  missingEquipment: string[];
  estimatedMinutes: number;
  /** Why these requirements were grouped / why this test exists. */
  rationale: string;
}

// ---------- Limit extraction from requirement text ----------

const UNIT =
  '(?:°\\s?C|°\\s?F|ms|µs|us|ns|sec|s|min|h|kbit/s|Mbit/s|bit/s|kHz|MHz|GHz|Hz|mV|kV|V|mA|kA|A|mW|kW|W|dBm|dB|%|mm|cm|km|m|kg|g|Nm|N|bar|kPa|Pa|C|K)';
const NUM = '[+-−]?\\d+(?:[.,]\\d+)?';
const RANGE_RE = new RegExp(`(${NUM})\\s?(${UNIT})?\\s+(?:to|through|and)\\s+(${NUM})\\s?(${UNIT})(?![A-Za-z])`, 'g');
const QTY_RE = new RegExp(`(${NUM})\\s?(${UNIT})(?![A-Za-z/])`, 'g');
const IP_RE = /\bIP\s?\d{2}[A-Z]?\b/g;

const UPPER_RE = /(within|at most|no more than|not exceed|less than|maximum|max\.?|up to|below|under|not more than|≤)\s*[^.;]{0,25}$/i;
const LOWER_RE = /(at least|no less than|minimum|min\.?|more than|greater than|above|not less than|≥)\s*[^.;]{0,25}$/i;

export interface Range {
  lo: string;
  hi: string;
  unit: string;
}
export interface Quantity {
  raw: string;
  value: string;
  unit: string;
  bound: 'max' | 'min' | 'nominal';
}
export interface Limits {
  ranges: Range[];
  quantities: Quantity[];
  ipRatings: string[];
}

const clean = (s: string): string => s.replace('−', '-').replace(/\s+/g, ' ').trim();

export function extractLimits(text: string): Limits {
  const ranges: Range[] = [];
  let rest = text;
  for (const m of text.matchAll(RANGE_RE)) {
    const unit = clean(m[4] ?? m[2] ?? '');
    ranges.push({ lo: clean(m[1]), hi: clean(m[3]), unit });
    rest = rest.replace(m[0], ' ');
  }
  const ipRatings = [...new Set([...text.matchAll(IP_RE)].map((m) => m[0].replace(/\s/g, '')))];
  rest = rest.replace(IP_RE, ' ');
  const quantities: Quantity[] = [];
  for (const m of rest.matchAll(QTY_RE)) {
    const before = rest.slice(Math.max(0, (m.index ?? 0) - 40), m.index ?? 0);
    const bound = UPPER_RE.test(before) ? 'max' : LOWER_RE.test(before) ? 'min' : 'nominal';
    quantities.push({ raw: clean(m[0]), value: clean(m[1]), unit: clean(m[2]), bound });
  }
  return { ranges, quantities, ipRatings };
}

const fmtQty = (q: Quantity): string => `${q.value} ${q.unit}`;
const describeLimit = (q: Quantity): string =>
  q.bound === 'max' ? `<= ${fmtQty(q)}` : q.bound === 'min' ? `>= ${fmtQty(q)}` : `${fmtQty(q)} (tolerance as specified)`;

// ---------- Equipment needs ----------

interface EquipmentRule {
  need: string;
  when: RegExp;
  match: RegExp;
}

const RULES: EquipmentRule[] = [
  { need: 'climate chamber', when: /temperature|thermal|°\s?C|\bcold\b|\bheat\b|climat/i, match: /chamber|climat|thermal|oven|environment/i },
  { need: 'humidity chamber', when: /humid|condensation/i, match: /humid|chamber|climat/i },
  { need: 'ingress protection test equipment', when: /\bIP\s?\d{2}|dust|water|splash|ingress/i, match: /\bip\b|dust|water|ingress|spray|jet/i },
  { need: 'vibration / shock test system', when: /vibration|shock|drop|mechanical impact/i, match: /vibr|shaker|shock|drop/i },
  { need: 'EMC test setup (receiver, antenna, LISN, ESD gun)', when: /\bEMC\b|emission|immunity|\bESD\b|radiated|conducted|interference/i, match: /emc|emi|receiver|antenna|lisn|esd|spectrum/i },
  { need: 'oscilloscope / timer', when: /\d\s?(ms|µs|us|ns)\b|response time|reaction time|within \d+\s?s\b|latency|delay|stop all|power-on|start-up|startup/i, match: /oscillo|scope|timer|counter|logic|dso/i },
  { need: 'power supply and multimeter', when: /\bvolt|supply|current|\d\s?(mA|A|V|mV)\b|power consumption|battery/i, match: /supply|dmm|multimeter|power|source|meter/i },
  { need: 'bus / protocol analyser', when: /\bCAN\b|ethernet|protocol|bus\b|modbus|profinet|serial|usb|interface/i, match: /\bcan\b|bus|analy|ethernet|protocol|logic|interface/i },
  { need: 'fault injection / safety test fixture', when: /emergency|fault|fail.?safe|safe state|safety function|stop/i, match: /fault|safety|fixture|e-?stop|oscillo|scope|logic/i },
  { need: 'life / endurance test rig', when: /MTBF|endurance|lifetime|life cycle|cycles|wear|burn.?in/i, match: /life|endur|burn|rig|cycl/i },
];

function needsFor(r: Requirement, limits: Limits): EquipmentRule[] {
  const hay = `${r.type} ${r.title} ${r.text} ${r.standards.map((s) => s.standard).join(' ')}`;
  const out = RULES.filter((rule) => rule.when.test(hay));
  if (limits.ipRatings.length && !out.some((o) => o.need.startsWith('ingress'))) out.push(RULES[2]);
  return out;
}

function pickEquipment(rule: EquipmentRule, equipment: Equipment[], pref: EquipmentPreference): Equipment | undefined {
  const usable = equipment.filter((e) => e.status !== 'in_repair' && rule.match.test(`${e.name} ${e.category} ${e.model}`));
  const allowed = pref === 'standard' ? usable.filter((e) => e.kind === 'standard') : usable;
  if (pref === 'company') return allowed.find((e) => e.kind === 'company') ?? allowed[0];
  // 'any' and 'standard': prefer standard equipment, fall back to company-specific when allowed
  return allowed.find((e) => e.kind === 'standard') ?? allowed[0];
}

// ---------- Step templates ----------

const BASE_MINUTES: Record<RequirementType, number> = {
  functional: 15,
  performance: 30,
  interface: 30,
  safety: 45,
  security: 60,
  environmental: 90,
  regulatory: 90,
  usability: 30,
  reliability: 240,
  maintainability: 30,
  constraint: 15,
  other: 20,
};

type CaseKind = 'nominal' | 'boundary' | 'off-nominal';

interface Section {
  steps: TestStep[];
  criteria: string[];
  environment: string[];
}

function sectionFor(r: Requirement, limits: Limits, kind: CaseKind): Section {
  const { ranges, quantities, ipRatings } = limits;
  const steps: TestStep[] = [];
  const criteria: string[] = [];
  const environment: string[] = [];
  const first = quantities[0];
  const statement = `${r.reqId}: ${r.text || r.title}`;

  if (kind === 'off-nominal') {
    steps.push({ action: `Apply an invalid, out-of-range or fault condition relevant to ${r.reqId} (e.g. wrong input, interrupted supply, bus error).`, expected: 'The item rejects or handles the condition without entering an unsafe or undefined state.' });
    steps.push({ action: 'Remove the condition and return to normal operation.', expected: 'The item recovers to normal operation as specified, without manual repair.' });
    criteria.push(`${r.reqId}: off-nominal conditions are handled safely and the item recovers.`);
    return { steps, criteria, environment };
  }

  if (kind === 'boundary') {
    if (ranges.length) {
      for (const g of ranges) {
        steps.push({ action: `Set the condition to the lower limit ${g.lo} ${g.unit} and let it stabilise.`, expected: 'Condition reached and stable within the equipment tolerance.' });
        steps.push({ action: `Run the function check for ${r.reqId} at ${g.lo} ${g.unit}.`, expected: 'Requirement is met at the lower limit.' });
        steps.push({ action: `Set the condition to the upper limit ${g.hi} ${g.unit} and let it stabilise.`, expected: 'Condition reached and stable within the equipment tolerance.' });
        steps.push({ action: `Run the function check for ${r.reqId} at ${g.hi} ${g.unit}.`, expected: 'Requirement is met at the upper limit.' });
        environment.push(`${g.lo} to ${g.hi} ${g.unit}`);
      }
    } else if (first) {
      steps.push({ action: `Set up worst-case conditions for ${r.reqId} (e.g. minimum supply voltage, maximum temperature, maximum load).`, expected: 'Worst-case conditions established and recorded.' });
      steps.push({ action: `Measure the value against the limit ${describeLimit(first)} at least 10 times.`, expected: `All results ${first.bound === 'max' ? 'are at or below' : first.bound === 'min' ? 'are at or above' : 'are within tolerance of'} ${fmtQty(first)}; record the margin.` });
      environment.push('Worst-case supply, temperature and load');
    } else {
      steps.push({ action: `Exercise ${r.reqId} at the limits of its operating envelope.`, expected: 'Requirement is met at all envelope limits.' });
    }
    criteria.push(`${r.reqId}: requirement is met at its limits.`);
    return { steps, criteria, environment };
  }

  // nominal
  switch (r.type) {
    case 'performance':
      steps.push({ action: 'Prepare the item and instrument the measurement point as described in the preconditions.', expected: 'Measurement setup is ready and calibrated.' });
      steps.push({ action: `Apply the stimulus for: ${statement}`, expected: 'Item responds.' });
      steps.push({ action: `Measure ${first ? `the value against ${describeLimit(first)}` : 'the performance value'}; repeat at least 10 times and record minimum, maximum and mean.`, expected: first ? `All measured values ${first.bound === 'max' ? '<=' : first.bound === 'min' ? '>=' : 'within tolerance of'} ${fmtQty(first)}.` : 'All values meet the specified limit.' });
      break;
    case 'environmental':
      if (ranges.length) {
        for (const g of ranges) {
          steps.push({ action: `Stabilise the item at ${g.lo} ${g.unit}, then at ${g.hi} ${g.unit}, and run the function check at each point.`, expected: 'Item operates as specified at both limits.' });
          environment.push(`${g.lo} to ${g.hi} ${g.unit}`);
        }
      } else if (ipRatings.length) {
        steps.push({ action: `Test the enclosure for ${ipRatings.join(', ')} according to the IEC 60529 procedure.`, expected: `Enclosure meets ${ipRatings.join(', ')} with no ingress and no loss of function.` });
        environment.push(ipRatings.join(', '));
      } else {
        steps.push({ action: `Expose the item to the environmental condition in: ${statement}`, expected: 'Item operates as specified during and after exposure.' });
      }
      steps.push({ action: 'Run a final visual and functional inspection after exposure.', expected: 'No damage or degradation.' });
      break;
    case 'interface':
      steps.push({ action: 'Connect the item to the bus or interface analyser and configure the parameters from the requirement.', expected: first ? `Link established at ${fmtQty(first)}.` : 'Link established.' });
      steps.push({ action: `Exercise the interface for: ${statement}`, expected: 'All messages/signals are correct in format, timing and content.' });
      steps.push({ action: 'Inject malformed or missing messages.', expected: 'Item handles errors as specified and keeps communicating.' });
      break;
    case 'safety':
      steps.push({ action: 'Bring the item to its normal operating state.', expected: 'Operating state confirmed.' });
      steps.push({ action: `Trigger the safety function: ${statement}`, expected: first ? `Safe state is reached ${first.bound === 'max' ? 'within' : 'in'} ${fmtQty(first)}.` : 'Safe state is reached.' });
      steps.push({ action: 'Repeat at least 10 times and record the reaction time each time.', expected: 'Every repetition meets the limit; no dangerous failure.' });
      steps.push({ action: 'Reset the safety function.', expected: 'Normal operation is only resumed through the specified reset.' });
      break;
    case 'regulatory':
      steps.push({ action: `Identify the applicable clauses (${r.standards.map((s) => (s.clause ? `${s.standard} ${s.clause}` : s.standard)).join('; ') || 'see requirement'}) and the harmonised test method.`, expected: 'Test method and limits are identified and documented.' });
      steps.push({ action: `Perform the conformity test for: ${statement}`, expected: 'Measured values meet the limits of the standard.' });
      steps.push({ action: 'Document the setup, equipment and results for the technical file.', expected: 'Test report is complete and traceable.' });
      break;
    case 'reliability':
      steps.push({ action: `Start the endurance / life test for: ${statement}`, expected: 'Test running, monitoring active.' });
      steps.push({ action: 'Log failures and operating time until the planned test duration is reached.', expected: first ? `No failures that contradict ${describeLimit(first)}.` : 'Failure rate is within the specified limit.' });
      break;
    case 'usability':
    case 'maintainability':
      steps.push({ action: `Have a representative user perform the task for: ${statement}`, expected: 'Task is completed without assistance within the expected effort.' });
      break;
    case 'security':
      steps.push({ action: `Attempt the attack or misuse scenario related to: ${statement}`, expected: 'The item resists it and logs the event as specified.' });
      break;
    default:
      steps.push({ action: 'Set the item to the initial state described in the preconditions.', expected: 'Item ready.' });
      steps.push({ action: `Stimulate or operate the item for: ${statement}`, expected: first ? `Behaviour matches ${describeLimit(first)}.` : 'Behaviour matches the requirement.' });
      steps.push({ action: 'Observe and record the result.', expected: 'Observed behaviour meets the requirement.' });
  }
  if (r.type !== 'environmental' && ranges.length) environment.push(ranges.map((g) => `${g.lo} to ${g.hi} ${g.unit}`).join(', '));
  criteria.push(`${r.reqId}: ${r.title || r.text}${first ? ` (${describeLimit(first)})` : ''} is met.`);
  return { steps, criteria, environment };
}

// ---------- Grouping & assembly ----------

const keyFor = (r: Requirement, strategy: GroupingStrategy, equipSig: string): string => {
  switch (strategy) {
    case 'per-requirement': return r.id;
    case 'by-type': return r.type;
    case 'by-type-level': return `${r.type}/${r.level}`;
    case 'by-standard': return r.standards[0]?.standard ?? '(no standard)';
    case 'by-equipment': return equipSig || '(no special equipment)';
  }
};

const titleCase = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

interface Analysed {
  req: Requirement;
  limits: Limits;
  rules: EquipmentRule[];
}

export function selectRequirements(d: ProjectData, o: GenerateOptions): Requirement[] {
  const active = d.requirements.filter((r) => r.status === 'active' && r.verificationMethod === 'test');
  if (o.scope === 'all-verifiable') return active;
  if (o.scope === 'selected') {
    const ids = new Set(o.requirementIds ?? []);
    return active.filter((r) => ids.has(r.id));
  }
  const covered = coveredRequirementIds(d.testCases.filter((t) => t.status !== 'obsolete'));
  return active.filter((r) => !covered.has(r.id));
}

export function generateTestCases(d: ProjectData, options: Partial<GenerateOptions> = {}): ProposedTest[] {
  const o: GenerateOptions = { ...DEFAULT_OPTIONS, ...options };
  const reqs = selectRequirements(d, o);
  const analysed: Analysed[] = reqs.map((req) => {
    const limits = extractLimits(`${req.title}. ${req.text}`);
    return { req, limits, rules: needsFor(req, limits) };
  });

  // 1. group
  const groups = new Map<string, Analysed[]>();
  for (const a of analysed) {
    const sig = a.rules.map((r) => r.need).sort().join(' + ');
    const k = keyFor(a.req, o.grouping, sig);
    groups.set(k, [...(groups.get(k) ?? []), a]);
  }

  // 2. chunk big groups, then build one or more tests per chunk
  const out: ProposedTest[] = [];
  let n = 0;
  const cap = Math.max(1, o.grouping === 'per-requirement' ? 1 : o.maxRequirementsPerTest);
  for (const [groupKey, members] of groups) {
    for (let i = 0; i < members.length; i += cap) {
      const chunk = members.slice(i, i + cap);
      const kinds: CaseKind[] = ['nominal'];
      if (o.splitCases) {
        if (chunk.some((m) => m.limits.ranges.length || m.limits.quantities.length || m.limits.ipRatings.length)) kinds.push('boundary');
        if (chunk.some((m) => ['functional', 'interface', 'safety', 'security'].includes(m.req.type))) kinds.push('off-nominal');
      }
      for (const kind of kinds) out.push(buildTest(d, o, groupKey, chunk, kind, ++n, chunk.length === members.length ? '' : ` (part ${Math.floor(i / cap) + 1})`));
    }
  }
  return out;
}

function buildTest(d: ProjectData, o: GenerateOptions, groupKey: string, chunk: Analysed[], kind: CaseKind, n: number, part: string): ProposedTest {
  const equipmentIds = new Set<string>();
  const missing = new Set<string>();
  for (const m of chunk) {
    for (const rule of m.rules) {
      const eq = pickEquipment(rule, d.equipment, o.equipmentPreference);
      if (eq) equipmentIds.add(eq.id);
      else missing.add(o.equipmentPreference === 'standard' ? `${rule.need} (standard equipment)` : rule.need);
    }
  }
  const steps: TestStep[] = [];
  const criteria: string[] = [];
  const env: string[] = [];
  chunk.forEach((m) => {
    const sec = sectionFor(m.req, m.limits, kind);
    const prefix = chunk.length > 1 ? `[${m.req.reqId}] ` : '';
    steps.push(...sec.steps.map((s) => ({ action: prefix + s.action, expected: s.expected })));
    criteria.push(...sec.criteria);
    env.push(...sec.environment);
  });
  const ids = chunk.map((m) => m.req.reqId);
  const single = chunk.length === 1 ? chunk[0].req : null;
  const kindLabel = kind === 'nominal' ? 'Verify' : kind === 'boundary' ? 'Boundary check' : 'Off-nominal check';
  const title = single
    ? `${kindLabel}: ${single.title || single.reqId}`
    : `${kindLabel}: ${o.grouping === 'by-equipment' ? groupKey : titleCase(groupKey)} requirements (${ids.length})${part}`;
  const equipNames = [...equipmentIds].map((id) => d.equipment.find((e) => e.id === id)?.name).filter(Boolean);
  const minutes = Math.round(
    chunk.reduce((s, m) => s + BASE_MINUTES[m.req.type], 0) * (kind === 'nominal' ? 1 : 0.5) * (chunk.length > 1 ? 0.8 : 1),
  );
  return {
    key: `gen-${n}`,
    title,
    objective: `Verify ${ids.join(', ')}${kind === 'nominal' ? '' : ` (${kind} conditions)`}.`,
    preconditions: [
      'Item under test is built to the released configuration and passes its power-on self-check.',
      equipNames.length ? `Equipment set up and in calibration: ${equipNames.join(', ')}.` : '',
      missing.size ? `Equipment still needed (not in catalogue): ${[...missing].join(', ')}.` : '',
    ].filter(Boolean).join(' '),
    steps,
    passCriteria: criteria.join(' '),
    environment: [...new Set(env)].join('; ') || 'Ambient laboratory conditions, nominal supply.',
    requirementIds: chunk.map((m) => m.req.id),
    equipmentIds: [...equipmentIds],
    missingEquipment: [...missing],
    estimatedMinutes: Math.max(5, minutes),
    rationale:
      chunk.length > 1
        ? `${chunk.length} requirements share ${o.grouping === 'by-equipment' ? 'the same equipment need' : o.grouping.replace('by-', '')} "${groupKey}", so one set-up verifies them together.`
        : kind === 'nominal'
          ? `One test for ${ids[0]}.`
          : `Additional ${kind} test for ${ids[0]}.`,
  };
}
