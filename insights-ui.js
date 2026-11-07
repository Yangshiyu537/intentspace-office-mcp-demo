// Administrator home: insights detected automatically by the review rule (no API key).
// The administrator adopts or declines each suggestion; later runs show what changed.
import { renderOfficeLayout, layoutRooms } from './office-layout.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fill = (text, values) => String(text).replace(/\{(\w+)\}/g, (_, key) => values[key] ?? '');

// A read-only copy of the meeting-room floor with one badge per detected room. IDs, focus and
// room click targets are removed so it cannot collide with the employee map on the same page.
export function renderInsightMap(view, t, locale = 'ja') {
  const rendered = renderOfficeLayout('meeting', locale, Object.fromEntries(layoutRooms.map(room => [room.id, 'available'])));
  let svg = rendered.svg
    .replace(/ id="meeting-seat-\d+"/g, '').replace(/ tabindex="[^"]*"/g, '').replace(/ role="[^"]*"/g, '').replace(/ data-seat-id="/g, ' data-insight-seat="')
    .replace(/id="(floor|room|unknown)"/g, 'id="insight-$1"').replace(/url\(#(floor|room|unknown)\)/g, 'url(#insight-$1)')
    .replace(/data-room="/g, 'data-insight-room="');
  const latest = new Map();
  for (const f of view?.findings ?? []) latest.set(f.room_id, f);
  const marks = [];
  const markers = [...svg.matchAll(/data-insight-room="([^"]+)"[\s\S]*?<g class="roomMarker"><rect x="([\d.-]+)" y="([\d.-]+)"/g)]
    .map(m => ({ id: m[1], cx: Number(m[2]) + 33, cy: Number(m[3]) - 4 + 31 }));
  const hits = (box, skip) => markers.some(m => m.id !== skip && box.x1 < m.cx + 40 && m.cx - 40 < box.x2 && box.y1 < m.cy + 33 && m.cy - 35 < box.y2);
  for (const marker of markers) {
    const finding = latest.get(marker.id);
    if (!finding) continue;
    const kind = finding.status === 'resolved' ? 'resolved' : finding.change;
    const label = t('insightMapBadge_' + kind), width = Math.max(108, label.length * (locale === 'en' ? 15 : 26) + 30);
    const right = { x: marker.cx + 40 + width / 2 + 6, y: marker.cy - 6 };
    const rightBox = { x1: right.x - width / 2, x2: right.x + width / 2, y1: right.y - 22, y2: right.y + 24 };
    const { x, y } = hits(rightBox, marker.id) ? { x: marker.cx, y: marker.cy - 62 } : right;
    const tail = hits(rightBox, marker.id) ? `M ${x - 9} ${y + 24} L ${x} ${y + 36} L ${x + 9} ${y + 24} Z` : `M ${x - width / 2} ${y - 8} L ${x - width / 2 - 12} ${y + 1} L ${x - width / 2} ${y + 10} Z`;
    marks.push(`<g class="insightPin ${esc(kind)}" aria-hidden="true"><rect x="${x - width / 2 + 3}" y="${y - 22 + 4}" width="${width}" height="46" fill="#14292a"/>`
      + `<rect x="${x - width / 2}" y="${y - 22}" width="${width}" height="46" class="insightPinBox"/>`
      + `<path d="${tail}" class="insightPinBox"/>`
      + `<text x="${x}" y="${y + 9}" text-anchor="middle" font-size="26" font-weight="700" font-family="system-ui,sans-serif" class="insightPinText">${esc(label)}</text></g>`);
    svg = svg.replace(`class="layoutRoom available" data-insight-room="${marker.id}"`, `class="layoutRoom available insightFlag-${esc(kind)}" data-insight-room="${marker.id}"`);
  }
  return `<svg class="insightMapSvg" viewBox="${rendered.box.join(' ')}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${esc(t('insightMapLabel'))}">${svg}${marks.join('')}</svg>`;
}

// Original pixel-art assistant (12x12 grid). It reports rule results; it is not an AI model.
const PIXELS = ['....gg......', '...gGg......', '....g.......', '..tttttttt..', '.tTTTTTTTTt.', '.tTwwTTwwTt.', '.tTwkTTwkTt.', '.tTTTTTTTTt.',
  '.tTTpTTpTTt.', '..tttttttt..', '...bbbbbb...', '..bb.bb.bb..'];
const PIXEL_COLORS = { g: '#6eaa75', G: '#b8dc76', t: '#1f4a4c', T: '#62b6bf', w: '#fff4d6', k: '#203f40', p: '#f4c869', b: '#d8bb7d' };
export function renderAssistant() {
  let rects = '';
  PIXELS.forEach((row, y) => [...row].forEach((c, x) => { if (PIXEL_COLORS[c]) rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${PIXEL_COLORS[c]}"/>`; }));
  return `<svg class="insightAssistant" viewBox="0 0 12 12" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
}
export function assistantMessage(view, t, locale = 'ja') {
  const findings = view?.findings ?? [], run = view?.last_run;
  if (!run) return '';
  const names = list => list.map(f => f.name).join('・');
  const fresh = findings.filter(f => f.status === 'open' && ['new', 'recurred'].includes(f.change));
  const improved = findings.filter(f => ['improved', 'better'].includes(f.outcome?.state));
  const resolved = findings.filter(f => f.status === 'resolved' && f.change === 'resolved' && !improved.includes(f));
  const ongoing = findings.filter(f => f.status === 'open' && f.change === 'persisting');
  const parts = [t('insightSay_' + run.trigger)];
  if (fresh.length) parts.push(t('insightSay_new').replace('{rooms}', names(fresh)));
  if (improved.length) parts.push(t('insightSay_improved').replace('{rooms}', names(improved)));
  if (resolved.length) parts.push(t('insightSay_resolved').replace('{rooms}', names(resolved)));
  if (ongoing.length) parts.push(t('insightSay_ongoing').replace('{rooms}', names(ongoing)));
  if (parts.length === 1) parts.push(t('insightSay_none'));
  return parts.join(locale === 'en' ? ' ' : '');
}

export function renderInsightBoard(view, t, locale = 'ja') {
  const time = at => { try { return new Date(at).toLocaleString(locale === 'en' ? 'en-GB' : 'ja-JP', { dateStyle: 'short', timeStyle: 'short' }); } catch { return at; } };
  const run = view?.last_run;
  const header = run
    ? '<div class="insightStatus"><span><b>' + esc(t('insightLastRun')) + '</b> ' + esc(time(run.at)) + '</span>'
      + '<span><b>' + esc(t('insightTriggerLabel')) + '</b> ' + esc(t('insightTrigger_' + run.trigger)) + '</span>'
      + (run.period ? '<span><b>' + esc(t('insightPeriod')) + '</b> ' + esc(run.period.start_date + ' → ' + run.period.end_date) + '</span>' : '')
      + '<span><b>' + esc(t('insightRecords')) + '</b> ' + esc(run.eligible_count) + '</span></div>'
    : '';
  const importRow = '<div class="insightImport row">' + (view?.batch_imported
    ? '<span class="small">' + esc(t('insightImported')) + '</span>'
    : '<button type="button" data-insight-import="1">' + esc(t('insightImport')) + '</button><span class="small">' + esc(t('insightImportHint')) + '</span>') + '</div>';
  const findings = view?.findings ?? [];
  const open = findings.filter(f => f.status === 'open');
  const empty = !run || run.status === 'insufficient_data' ? t('insightNoData') : !open.length ? t('insightEmpty') : '';
  const cards = findings.map(f => insightCard(f, t, time)).join('');
  const runs = (view?.runs ?? []).map(r => '<li>' + esc(fill(t('insightRunLine'), { at: time(r.at), trigger: t('insightTrigger_' + r.trigger),
    new: r.counts.new + r.counts.recurred, persisting: r.counts.persisting, resolved: r.counts.resolved })) + '</li>').join('');
  const say = assistantMessage(view, t, locale);
  const stage = run ? '<div class="insightStage"><div class="insightMapPane">' + renderInsightMap(view, t, locale) + '</div>'
      + '<div class="insightSide">'
      + (say ? '<div class="insightSpeech">' + renderAssistant() + '<div class="insightBubble"><p>' + esc(say) + '</p><span class="small">' + esc(t('insightSayNote')) + '</span></div></div>' : '')
      + (empty ? '<p class="insightEmpty">' + esc(empty) + '</p>' : '')
      + '<div class="insightCards">' + cards + '</div>'
      + '<p class="small insightLimits">' + esc(t('insightLimits')) + '</p>'
      + (runs ? '<details class="insightRuns"><summary>' + esc(t('insightRuns')) + ' (' + (view.runs.length) + ')</summary><ol>' + runs + '</ol></details>' : '')
      + '</div></div>'
    : (empty ? '<p class="insightEmpty">' + esc(empty) + '</p>' : '');
  return '<div class="insightBoard">' + header + importRow + stage + '</div>';
}

function insightCard(f, t, time) {
  const id = esc(f.finding_id), latest = f.latest ?? {}, range = latest.planned_people_range;
  const people = range ? (range.min === range.max ? range.min : range.min + '–' + range.max) : '—';
  const fact = f.status === 'resolved' && f.after
    ? fill(t('insightResolvedFact'), { total: f.after.total, count: f.after.oversized_count, percent: f.after.oversized_percent })
    : fill(t('insightOpenFact'), { total: latest.total, count: latest.oversized_count, percent: latest.oversized_percent, people, alternatives: latest.alternative_count });
  // A trend needs at least two checks; one value alone is shown in the fact sentence.
  const trend = (f.history ?? []).length > 1 ? f.history.map(h => h.oversized_percent + '%').join(' → ') : '';
  const step = latest.action === 'review_allocation' ? 'suggestionStep_guide_smaller_rooms' : 'suggestionStep_review_constraints';
  const decision = f.decision;
  let actions = '';
  if (decision) {
    actions = '<p class="insightDecision ' + esc(decision.decision) + '"><b>' + esc(t(decision.decision === 'adopted' ? 'insightAdopted' : 'insightRejected')) + '</b> '
      + esc(time(decision.at)) + '</p><div class="row"><button type="button" data-insight-decide="reopened" data-insight-id="' + id + '">' + esc(t('insightUndo')) + '</button></div>';
  } else if (f.status === 'open') {
    actions = '<div class="row insightButtons"><button type="button" class="primary" data-insight-decide="adopted" data-insight-id="' + id + '">' + esc(t('insightAdopt')) + '</button>'
      + '<button type="button" data-insight-decide="rejected" data-insight-id="' + id + '">' + esc(t('insightReject')) + '</button>'
      + '<button type="button" data-insight-investigate="' + id + '">' + esc(t('insightInvestigate')) + '</button></div>';
  }
  const outcome = f.outcome
    ? '<p class="insightOutcome ' + esc(f.outcome.state) + '"><b>' + esc(t('insightOutcomeLabel')) + '</b> '
      + esc(fill(t('insightOutcome_' + f.outcome.state), { before: f.outcome.baseline.oversized_percent, after: f.outcome.current?.oversized_percent ?? '' })) + '</p>'
    : '';
  return '<article class="insightCard ' + esc(f.change) + ' ' + esc(f.status) + '" data-insight-card="' + id + '">'
    + '<header><span class="insightBadge ' + esc(f.change) + '">' + esc(t('insightBadge_' + f.change)) + '</span>'
    + '<h3>' + esc(fill(t('insightRoom'), { name: f.name, capacity: latest.capacity ?? '' })) + '</h3></header>'
    + '<p>' + esc(fact) + '</p>'
    + (trend ? '<p class="small"><b>' + esc(t('insightTrend')) + '</b> ' + esc(trend) + '</p>' : '')
    + (f.status === 'open' ? '<p class="insightProposal"><b>' + esc(t('insightProposal')) + '</b> ' + esc(t(step)) + '</p>' : '')
    + outcome + actions + '</article>';
}

export function insightMetrics(view, t) {
  const findings = view?.findings ?? [];
  return [[t('insightOpenCount'), findings.filter(f => f.status === 'open').length],
    [t('insightNewCount'), findings.filter(f => f.status === 'open' && ['new', 'recurred'].includes(f.change)).length],
    [t('insightResolvedCount'), findings.filter(f => f.status === 'resolved').length],
    [t('insightAdoptedCount'), findings.filter(f => f.decision?.decision === 'adopted').length]];
}

export function createInsightsUI({ document, api, perform, getText, getLocale, isActive, getWorkspace = () => null, onInvestigate, setPager }) {
  const $ = id => document.getElementById(id), t = key => getText()(key);
  let view = null;
  function render() {
    if (!isActive()) return;
    const metrics = insightMetrics(view, t);
    $('adminMetrics').hidden = !view; $('adminMetrics').innerHTML = metrics.map(([label, value]) => '<div class="metric"><span>' + esc(label) + '</span><b>' + esc(value) + '</b></div>').join('');
    $('adminResults').innerHTML = view ? renderInsightBoard({ ...view, batch_imported: view.batch_imported ?? getWorkspace()?.demo_batch_imported }, t, getLocale()) : '';
    setPager?.(1);
  }
  async function load() { view = await api('insights'); render(); }
  $('adminResults').addEventListener('click', event => {
    if (!isActive()) return;
    const decide = event.target.closest('[data-insight-decide]');
    if (decide?.dataset.insightDecide) {
      perform(async () => { view = await api('insights/decision', { body: { finding_id: decide.dataset.insightId, decision: decide.dataset.insightDecide } }); render(); });
      return;
    }
    if (event.target.closest('[data-insight-import]')?.dataset.insightImport) { perform(async () => { view = await api('insights/import-batch', { body: {} }); render(); }); return; }
    const investigate = event.target.closest('[data-insight-investigate]');
    if (investigate?.dataset.insightInvestigate) {
      const finding = view?.findings.find(f => f.finding_id === investigate.dataset.insightInvestigate);
      const period = finding?.history.at(-1)?.period ?? view?.last_run?.period;
      if (period) onInvestigate?.(period);
    }
  });
  return { load, render, isActive, clear() { view = null; }, current: () => view };
}
