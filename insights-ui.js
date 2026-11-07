// Administrator home: insights detected automatically by the review rule (no API key).
// The administrator adopts or declines each suggestion; later runs show what changed.
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fill = (text, values) => String(text).replace(/\{(\w+)\}/g, (_, key) => values[key] ?? '');

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
  return '<div class="insightBoard">' + header + importRow
    + (empty ? '<p class="insightEmpty">' + esc(empty) + '</p>' : '')
    + '<div class="insightCards">' + cards + '</div>'
    + '<p class="small insightLimits">' + esc(t('insightLimits')) + '</p>'
    + (runs ? '<details class="insightRuns"><summary>' + esc(t('insightRuns')) + ' (' + (view.runs.length) + ')</summary><ol>' + runs + '</ol></details>' : '')
    + '</div>';
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
