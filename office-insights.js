// Automatic change detection for administrators. No API key and no chat input are needed:
// a fixed, inspectable rule (analyzeRoomFit) runs whenever workspace data changes or a new
// day starts, and the result is compared with the previous run. The Agent is optional and
// only used when the administrator asks for a deeper investigation.
import { analyzeRoomFit } from './office-improvements.js';

export const INSIGHT_RULE_VERSION = 1;
const MAX_RUNS = 20, MAX_HISTORY = 10, MAX_LOG = 10, WINDOW_DATES = 5;
export const INSIGHT_TRIGGERS = ['initial', 'daily', 'data_changed', 'new_data', 'admin_edit', 'booking', 'meeting_state'];
export const INSIGHT_DECISIONS = ['adopted', 'rejected', 'reopened'];

export function emptyInsights() {
  return { rule_version: INSIGHT_RULE_VERSION, runs: [], findings: {}, last_revision: null, last_run_date: null, run_count: 0 };
}

// Map the request that changed data to a short, translatable trigger code.
export function triggerForPath(path) {
  if (path === '/api/office/insights/import-batch') return 'new_data';
  if (path.startsWith('/api/office/admin/')) return 'admin_edit';
  if (['/api/office/confirm', '/api/office/rebook', '/api/office/replan', '/api/office/day-plan'].includes(path)) return 'booking';
  if (['/api/office/transition', '/api/office/attendance'].includes(path)) return 'meeting_state';
  return 'data_changed';
}

// The latest five dates that hold meeting reservations up to today. Using dates with data,
// rather than a fixed calendar week, keeps the fictional history visible after new bookings.
export function detectionWindow(reservations, rooms, today) {
  const meeting = new Set(rooms.filter(room => room.kind === 'meeting').map(room => room.id));
  const dates = [...new Set(reservations
    .filter(record => !record.deleted && record.status !== 'cancelled' && meeting.has(record.space_id) && record.date <= today)
    .map(record => record.date))].sort();
  if (!dates.length) return null;
  const recent = dates.slice(-WINDOW_DATES);
  return { start_date: recent[0], end_date: recent.at(-1), dates: recent.length };
}

const metricsOf = item => ({ total: item.total, oversized_count: item.oversized_count, oversized_percent: item.oversized_percent,
  alternative_count: item.alternative_count });

// One detection run. Pure: returns a new insights object and never mutates the input.
export function runInsightDetection(previous, { rooms, reservations, today, at, trigger, revision }) {
  const state = structuredClone(previous?.rule_version === INSIGHT_RULE_VERSION ? previous : emptyInsights());
  const period = detectionWindow(reservations, rooms, today);
  const seq = state.run_count + 1, runId = 'run-' + seq;
  const analysis = period ? analyzeRoomFit({ rooms, reservations }, period) : null;
  const flagged = new Map((analysis?.items ?? []).map(item => [item.finding_id, item]));
  const counts = { new: 0, persisting: 0, resolved: 0, recurred: 0 };
  for (const [id, item] of flagged) {
    const existing = state.findings[id];
    const latest = { ...metricsOf(item), capacity: item.capacity, planned_people_range: item.planned_people_range, action: item.action,
      evidence: item.evidence.slice(0, 3).map(e => ({ reservation_id: e.reservation_id, date: e.date, start: e.start, end: e.end,
        people: e.people, alternatives: e.alternatives.map(a => a.name) })) };
    if (!existing) {
      state.findings[id] = { finding_id: id, room_id: item.room_id, name: item.name, type: item.finding_type, status: 'open', change: 'new',
        first_seen_run: runId, last_seen_run: runId, resolved_run: null, latest, history: [], decision: null, decision_log: [] };
      counts.new++;
    } else {
      existing.change = existing.status === 'resolved' ? 'recurred' : 'persisting';
      counts[existing.change]++;
      Object.assign(existing, { status: 'open', last_seen_run: runId, resolved_run: null, latest, name: item.name });
    }
    state.findings[id].history.push({ run_id: runId, seq, at, period, flagged: true, ...metricsOf(item) });
  }
  for (const finding of Object.values(state.findings)) {
    if (flagged.has(finding.finding_id) || finding.status === 'resolved') continue;
    // The room no longer meets the rule. Keep the latest measured values for the outcome view.
    const item = rooms.find(room => room.id === finding.room_id);
    const records = (analysis ? reservations.filter(r => r.space_id === finding.room_id && r.date >= period.start_date && r.date <= period.end_date
      && !r.deleted && r.status !== 'cancelled' && r.source !== 'attendance') : []);
    const rule = analysis?.rule ?? { max_people: 4, max_capacity_ratio: 0.5 };
    const small = records.filter(r => Number.isInteger(r.people) && item && r.people <= rule.max_people && r.people / item.capacity <= rule.max_capacity_ratio);
    const after = { total: records.length, oversized_count: small.length,
      oversized_percent: records.length ? Math.round(small.length / records.length * 100) : 0, alternative_count: null };
    Object.assign(finding, { status: 'resolved', change: 'resolved', resolved_run: runId, after });
    finding.history.push({ run_id: runId, seq, at, period, flagged: false, ...after });
    counts.resolved++;
  }
  for (const finding of Object.values(state.findings)) finding.history = finding.history.slice(-MAX_HISTORY);
  state.runs.push({ id: runId, at, trigger, revision, today, period, eligible_count: analysis?.eligible_count ?? 0,
    status: analysis?.status ?? 'insufficient_data', open_count: flagged.size, counts });
  state.runs = state.runs.slice(-MAX_RUNS);
  Object.assign(state, { last_revision: revision, last_run_date: today, run_count: state.run_count + 1, rule: analysis?.rule ?? null });
  return state;
}

// Run only when something changed: new data, a new day, or a rule update.
export function needsDetection(insights, { revision, today }) {
  if (!insights || insights.rule_version !== INSIGHT_RULE_VERSION || !insights.runs.length) return 'initial';
  if (insights.last_revision !== revision) return 'data_changed';
  if (insights.last_run_date !== today) return 'daily';
  return null;
}

// Administrator decision on one finding. The baseline is kept so later runs can show the effect.
export function decideInsight(insights, { finding_id, decision, note = '', at }) {
  const state = structuredClone(insights);
  const finding = state.findings[finding_id];
  if (!finding) { const error = new Error('insight_unknown'); error.status = 404; throw error; }
  if (!INSIGHT_DECISIONS.includes(decision)) { const error = new Error('insight_decision'); error.status = 400; throw error; }
  if (decision !== 'reopened' && finding.status !== 'open') { const error = new Error('insight_not_open'); error.status = 409; throw error; }
  const entry = { decision, at, after_seq: state.run_count, note: String(note).slice(0, 200),
    baseline: { total: finding.latest.total, oversized_count: finding.latest.oversized_count, oversized_percent: finding.latest.oversized_percent } };
  finding.decision = decision === 'reopened' ? null : entry;
  finding.decision_log = [...finding.decision_log, entry].slice(-MAX_LOG);
  return state;
}

// Effect of an adopted suggestion, measured by the same rule in later runs.
export function insightOutcome(finding) {
  const decision = finding.decision;
  if (!decision || decision.decision !== 'adopted') return null;
  const later = finding.history.filter(entry => entry.seq > decision.after_seq);
  if (!later.length) return { state: 'waiting', baseline: decision.baseline };
  const last = later.at(-1);
  const delta = last.oversized_percent - decision.baseline.oversized_percent;
  return { state: !last.flagged ? 'improved' : delta < 0 ? 'better' : delta > 0 ? 'worse' : 'unchanged',
    baseline: decision.baseline, current: { total: last.total, oversized_count: last.oversized_count, oversized_percent: last.oversized_percent } };
}

// Public, read-only view for the administrator screen.
export function insightsView(insights) {
  const state = insights ?? emptyInsights();
  const order = { new: 0, recurred: 1, persisting: 2, resolved: 3 };
  const findings = Object.values(state.findings).map(finding => ({ ...finding, outcome: insightOutcome(finding) }))
    .sort((a, b) => (order[a.change] ?? 9) - (order[b.change] ?? 9) || (b.latest?.oversized_count ?? 0) - (a.latest?.oversized_count ?? 0) || a.name.localeCompare(b.name));
  return { rule_version: state.rule_version, rule: state.rule ?? null, last_run: state.runs.at(-1) ?? null, runs: [...state.runs].reverse(),
    findings, open_count: findings.filter(f => f.status === 'open').length, simulation: true, needs_api_key: false,
    meaning: 'Rule-based detection on simulated bookings. Planned headcount is not measured occupancy. Decisions are recorded, no booking is changed.' };
}
