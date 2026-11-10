import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { officeRooms, createOfficeService, handleStoredOfficeRequest } from './office-service.js';
import { historicalDemoReservations, nextWeekDemoReservations, createHistoricalDemoState, HISTORICAL_DEMO_ANCHOR } from './meeting-state.js';
import { runInsightDetection, needsDetection, decideInsight, insightsView, detectionWindow, triggerForPath } from './office-insights.js';
import { renderInsightBoard, insightMetrics, renderInsightMap, assistantMessage } from './insights-ui.js';
import { translator, messages } from './ui-i18n.js';
import { errorResponse } from './http-utils.js';

const now = () => new Date('2026-11-08T03:00:00Z');
const week1 = historicalDemoReservations(HISTORICAL_DEMO_ANCHOR, officeRooms);
const week2 = nextWeekDemoReservations(HISTORICAL_DEMO_ANCHOR, officeRooms);
const byName = view => Object.fromEntries(view.findings.map(f => [f.name, f]));
const detect = (previous, reservations, extra = {}) => runInsightDetection(previous, { rooms: officeRooms, reservations, today: '2026-11-08',
  at: extra.at ?? now().toISOString(), trigger: extra.trigger ?? 'initial', revision: extra.revision ?? 1 });

test('自動検知：初回はB・Xを新規、2週目取り込み後はB解消・X継続・G新規', () => {
  const first = detect(null, week1);
  let view = byName(insightsView(first));
  assert.deepEqual(Object.keys(view).sort(), ['B', 'X']);
  assert.equal(view.B.change, 'new'); assert.equal(view.X.change, 'new');
  assert.deepEqual(first.runs.at(-1).period, { start_date: '2026-10-16', end_date: '2026-10-22', dates: 5 });
  const second = detect(first, [...week1, ...week2], { trigger: 'new_data', revision: 2 });
  view = byName(insightsView(second));
  assert.equal(view.B.status, 'resolved'); assert.equal(view.B.after.oversized_count, 0);
  assert.equal(view.X.change, 'persisting'); assert.equal(view.G.change, 'new');
  assert.deepEqual(second.runs.at(-1).counts, { new: 1, persisting: 1, resolved: 1, recurred: 0 });
  assert.deepEqual(view.B.history.map(h => h.oversized_percent), [100, 0]);
  // The input state is never mutated.
  assert.equal(first.runs.length, 1);
});

test('自動検知：同じ版数・同じ日なら再実行しない。データ変更・日付変更で再実行', () => {
  const state = detect(null, week1, { revision: 5 });
  assert.equal(needsDetection(null, { revision: 5, today: '2026-11-08' }), 'initial');
  assert.equal(needsDetection(state, { revision: 5, today: '2026-11-08' }), null);
  assert.equal(needsDetection(state, { revision: 6, today: '2026-11-08' }), 'data_changed');
  assert.equal(needsDetection(state, { revision: 5, today: '2026-11-09' }), 'daily');
  assert.equal(triggerForPath('/api/office/admin/delete'), 'admin_edit');
  assert.equal(triggerForPath('/api/office/confirm'), 'booking');
  assert.equal(triggerForPath('/api/office/insights/import-batch'), 'new_data');
});

test('採用・見送り：判断を記録し、採用後の変化を同じルールで測る。解消後は採否できない', () => {
  const first = detect(null, week1);
  const id = Object.values(first.findings).find(f => f.name === 'B').finding_id;
  const adopted = decideInsight(first, { finding_id: id, decision: 'adopted', note: '小会議室へ案内', at: now().toISOString() });
  let b = byName(insightsView(adopted)).B;
  assert.equal(b.decision.decision, 'adopted'); assert.equal(b.decision.baseline.oversized_percent, 100);
  assert.equal(b.outcome.state, 'waiting');
  const later = detect(adopted, [...week1, ...week2], { revision: 2 });
  b = byName(insightsView(later)).B;
  assert.equal(b.outcome.state, 'improved'); assert.equal(b.outcome.current.oversized_percent, 0);
  assert.throws(() => decideInsight(later, { finding_id: id, decision: 'rejected', at: now().toISOString() }), /insight_not_open/);
  const reopened = decideInsight(later, { finding_id: id, decision: 'reopened', at: now().toISOString() });
  assert.equal(reopened.findings[id].decision, null); assert.equal(reopened.findings[id].decision_log.length, 2);
  assert.throws(() => decideInsight(first, { finding_id: 'room-fit:none', decision: 'adopted', at: now().toISOString() }), /insight_unknown/);
  const x = Object.values(first.findings).find(f => f.name === 'X').finding_id;
  assert.equal(decideInsight(first, { finding_id: x, decision: 'rejected', at: now().toISOString() }).findings[x].decision.decision, 'rejected');
});

test('採用後の再確認：対象室の有効予約が不足している間は解消せず、データが揃ってから判定する', () => {
  const first = detect(null, week1);
  const original = byName(insightsView(first)).B;
  const adopted = decideInsight(first, { finding_id: original.finding_id, decision: 'adopted', at: now().toISOString() });
  const largeBooking = week2.find(row => row.name === 'B');
  const otherRooms = week2.filter(row => row.name !== 'B');
  for (const reservations of [[], otherRooms, [...otherRooms, largeBooking, largeBooking, { ...largeBooking, id: 'preset', source: 'preset' }]]) {
    const sparse = detect(adopted, reservations, { revision: 2 });
    const view = insightsView(sparse);
    const b = byName(view).B;
    assert.equal(b.status, 'open');
    assert.equal(b.change, 'insufficient_data');
    assert.equal(b.outcome.state, 'waiting');
    assert.deepEqual(b.history, original.history);
    assert.equal(view.last_run.counts.resolved, 0);
    const t = translator('ja');
    const html = renderInsightBoard(view, t, 'ja');
    assert.ok(html.includes(t('insightRoomNoData')));
    assert.match(html, /insightFlag-insufficient_data/);
    assert.doesNotMatch(html, /100% → 現在 0%/);
    const recovered = byName(insightsView(detect(sparse, week2, { revision: 3 }))).B;
    assert.equal(recovered.status, 'resolved');
    assert.equal(recovered.outcome.state, 'improved');
  }
});

test('検知期間：今日以降の予約は含めず、データのある直近5日を使う。データなしは期間なし', () => {
  assert.equal(detectionWindow([], officeRooms, '2026-11-08'), null);
  const future = { ...week1[0], id: 'future', date: '2026-12-01' };
  assert.equal(detectionWindow([...week1, future], officeRooms, '2026-11-08').end_date, '2026-10-22');
  const empty = detect(null, []);
  assert.equal(empty.runs.at(-1).status, 'insufficient_data'); assert.equal(Object.keys(empty.findings).length, 0);
});

function memoryStorage() {
  let saved = null;
  return { load: () => saved && structuredClone(saved), commit(expected, state) { if ((saved?.version ?? 0) !== expected) return false; saved = { version: expected + 1, state: structuredClone(state) }; return true; }, peek: () => saved };
}
const call = async (storage, path, body) => {
  const request = new Request('http://demo.test/api/office/' + path, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://demo.test' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  // Same as worker.js: thrown HttpErrors become JSON responses.
  let response;
  try { response = await handleStoredOfficeRequest(request, storage, { now, withDemoHistory: true }); } catch (error) { response = errorResponse(error); }
  return { status: response.status, body: await response.json() };
};

test('保存型ワークスペース：初回チェックを保存し、取り込み・判断も次のリクエストに残る', async () => {
  const storage = memoryStorage();
  await call(storage, 'workspace');
  let result = await call(storage, 'insights');
  assert.equal(result.status, 200); assert.equal(result.body.last_run.trigger, 'initial'); assert.equal(result.body.needs_api_key, false);
  assert.equal(storage.peek().state.insights.runs.length, 1, 'detection result is persisted after a GET');
  result = await call(storage, 'insights');
  assert.equal(result.body.runs.length, 1, 'no rerun without a change');
  const b = result.body.findings.find(f => f.name === 'B').finding_id;
  result = await call(storage, 'insights/decision', { finding_id: b, decision: 'adopted' });
  assert.equal(result.body.findings.find(f => f.name === 'B').decision.decision, 'adopted');
  result = await call(storage, 'insights/import-batch', {});
  assert.equal(result.body.last_run.trigger, 'new_data'); assert.equal(result.body.batch_imported, true);
  const view = byName(result.body);
  assert.equal(view.B.outcome.state, 'improved'); assert.equal(view.G.change, 'new');
  result = await call(storage, 'insights/import-batch', {});
  assert.equal(result.status, 409); assert.equal(result.body.error, 'insight_batch_imported');
  result = await call(storage, 'insights/decision', { finding_id: b, decision: 'maybe' });
  assert.equal(result.status, 400);
});

test('自動再実行：管理者が予約を削除すると、聞かなくても確認ルールが再実行される', async () => {
  const workspace = createHistoricalDemoState({ rooms: officeRooms, now });
  const service = createOfficeService({ workspace, now });
  const post = (path, body) => service(new Request('http://demo.test/api/office/' + path, { method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://demo.test' }, body: JSON.stringify(body) }));
  await service(new Request('http://demo.test/api/office/insights', { headers: { origin: 'http://demo.test' } }));
  const target = workspace.snapshot().reservations.find(r => r.name === 'X' && r.source === 'demo_history');
  const response = await post('admin/delete', { operation_id: randomUUID(), confirmed: true, meeting_id: target.id, expected_version: target.version });
  assert.equal(response.status, 200);
  const view = workspace.insights();
  assert.equal(view.runs.length, 2); assert.equal(view.last_run.trigger, 'admin_edit');
  assert.equal(byName(view).X.latest.total, 4);
});

test('気づき画面：日英文言が揃い、AIキーなしで新規カード・採否ボタン・履歴を表示', () => {
  for (const key of Object.keys(messages.ja).filter(k => k.startsWith('insight'))) assert.ok(messages.en[key], key);
  const state = detect(null, week1);
  for (const locale of ['ja', 'en']) {
    const t = translator(locale), html = renderInsightBoard({ ...insightsView(state), batch_imported: false }, t, locale);
    assert.match(html, /data-insight-decide="adopted"/); assert.match(html, /data-insight-import="1"/);
    assert.match(html, new RegExp(t('insightBadge_new'))); assert.doesNotMatch(html, /undefined|\{\w+\}/);
    assert.doesNotMatch(html, /<script|onclick=/);
  }
  const t = translator('ja');
  assert.deepEqual(insightMetrics(insightsView(state), t).map(([, v]) => v), [2, 2, 0, 0]);
  const html = renderInsightBoard({ ...insightsView(state), batch_imported: true }, t, 'ja');
  assert.doesNotMatch(html, /data-insight-import/);
});

test('気づき地図：部屋ごとのバッジ、IDとフォーカスの重複なし、案内文は検知結果だけを述べる', () => {
  const first = detect(null, week1), id = Object.values(first.findings).find(f => f.name === 'B').finding_id;
  const later = detect(decideInsight(first, { finding_id: id, decision: 'adopted', at: now().toISOString() }), [...week1, ...week2], { trigger: 'new_data', revision: 2 });
  const view = insightsView(later);
  for (const locale of ['ja', 'en']) {
    const t = translator(locale), svg = renderInsightMap(view, t, locale);
    assert.equal((svg.match(/class="insightPin /g) ?? []).length, 3);
    for (const kind of ['new', 'persisting', 'resolved']) assert.match(svg, new RegExp('insightFlag-' + kind));
    assert.doesNotMatch(svg, / id="meeting-seat|tabindex=|role="button"|data-room=|data-seat-id=/);
    assert.match(svg, /id="insight-floor"/); assert.doesNotMatch(svg, /url\(#floor\)/);
    const say = assistantMessage(view, t, locale);
    assert.match(say, new RegExp(t('insightSay_new_data').slice(0, 6)));
    assert.match(say, /G/); assert.match(say, /B/); assert.match(say, /X/);
    if (locale === 'ja') assert.doesNotMatch(say, /。 /);
  }
  assert.equal(assistantMessage(null, translator('ja')), '');
});
