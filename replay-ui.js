// "Real-day replay": the supplied Bitkey reservation sample played back on the meeting-room floor.
// Local only; the public deployment answers {source:'unavailable'} and this screen says so.
import { renderFloorWithPins } from './insights-ui.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fill = (text, values) => String(text).replace(/\{(\w+)\}/g, (_, key) => values[key] ?? '');
export const clockText = minute => String(Math.floor(minute / 60)).padStart(2, '0') + ':' + String(minute % 60).padStart(2, '0');
export const REPLAY_START = 7 * 60, REPLAY_END = 22 * 60, REPLAY_STEP = 15;
const RULE = { max_people: 4, max_capacity_ratio: 0.5, min_capacity: 8 };
const isSmallParty = b => b.capacity >= RULE.min_capacity && b.people <= RULE.max_people && b.people / b.capacity <= RULE.max_capacity_ratio;

export function replayFrameView(day, minute) {
  const active = (day?.bookings ?? []).filter(b => b.start <= minute && minute < b.end);
  const off = (day?.off_map ?? []).filter(b => b.status === 'used' && b.start <= minute && minute < b.end);
  return { in_use: active.filter(b => b.status === 'used'), no_show: active.filter(b => b.status === 'no_show'),
    multi_booth: off.filter(b => b.group === 'multi_booth').length, single_booth: off.filter(b => b.group === 'single_booth').length };
}
// The minute with the most rooms in use, so the replay opens on a lively moment.
export function peakMinute(day) {
  let best = 10 * 60, count = -1;
  for (let m = 8 * 60; m <= 20 * 60; m += REPLAY_STEP) {
    const n = replayFrameView(day, m).in_use.length;
    if (n > count) { best = m; count = n; }
  }
  return best;
}
export function dayStats(day) {
  const used = (day?.bookings ?? []).filter(b => b.status === 'used'), big = used.filter(b => b.capacity >= RULE.min_capacity);
  let peak = 0;
  for (let m = REPLAY_START; m < REPLAY_END; m += 5) peak = Math.max(peak, replayFrameView(day, m).in_use.length);
  return { used: used.length, peak, big: big.length, small: big.filter(isSmallParty).length };
}

export function renderReplayMap(mode, summary, day, minute, t, locale) {
  const pins = [], classes = {};
  if (mode === 'trend') {
    for (const room of summary?.trend?.rooms ?? []) {
      const kind = room.small_percent >= 60 ? 'new' : 'persisting';
      pins.push({ room_id: room.room_id, kind, label: fill(t('replayTrendPin'), { percent: Math.round(room.small_percent) }) });
      classes[room.room_id] = 'insightFlag-' + kind;
    }
  } else {
    const frame = replayFrameView(day, minute), seen = new Set();
    for (const b of frame.in_use) {
      if (seen.has(b.room_id)) continue; seen.add(b.room_id);
      const kind = isSmallParty(b) ? 'small' : 'live';
      pins.push({ room_id: b.room_id, kind, label: fill(t('replayPeoplePin'), { people: b.people, capacity: b.capacity ?? '?' }) });
      classes[b.room_id] = kind === 'small' ? 'replaySmall' : 'replayInUse';
    }
    for (const b of frame.no_show) if (!seen.has(b.room_id)) { seen.add(b.room_id); pins.push({ room_id: b.room_id, kind: 'ghost', label: t('replayNoShowPin') }); classes[b.room_id] = 'replayNoShow'; }
  }
  return renderFloorWithPins({ pins, classes, locale, label: t('replayMapLabel'), svgClass: 'insightMapSvg replayMapSvg' });
}

const WEEKDAYS = { ja: ['日', '月', '火', '水', '木', '金', '土'], en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] };
export function dayLabel(date, weekday, locale) { return date + '（' + (WEEKDAYS[locale] ?? WEEKDAYS.ja)[weekday] + '）'; }

export function renderReplaySide(mode, summary, day, minute, t, locale) {
  return replaySideBody(mode, summary, day, minute, t, locale) + '<p class="small replayNote">' + esc(t('replayNote')) + '</p>';
}
function replaySideBody(mode, summary, day, minute, t, locale) {
  if (mode === 'trend') {
    const tr = summary?.trend;
    if (!tr) return '';
    return '<div class="replayHeadline"><b>' + esc(fill(t('replayTrendHeadline'), { percent: tr.small_percent })) + '</b>'
      + '<p>' + esc(fill(t('replayTrendSub'), { used: tr.used.toLocaleString(), start: summary.coverage.start, end: summary.coverage.end,
        free: tr.free_percent })) + '</p></div>'
      + '<ul class="replayList">' + tr.rooms.map(r => '<li><b>' + esc(fill(t('replayRoom'), { name: r.name, capacity: r.capacity })) + '</b><span>'
        + esc(fill(t('replayTrendRow'), { percent: r.small_percent, small: r.small, used: r.used, conservative: r.small_2to4_percent })) + '</span></li>').join('') + '</ul>';
  }
  const frame = replayFrameView(day, minute);
  const rows = frame.in_use.map(b => '<li class="' + (isSmallParty(b) ? 'small' : '') + '"><b>' + esc(fill(t('replayRoom'), { name: b.name, capacity: b.capacity ?? '?' })) + '</b>'
    + '<span>' + esc(fill(t('replayRow'), { people: b.people, from: clockText(b.start), to: clockText(b.end) }))
    + (isSmallParty(b) ? ' <em>' + esc(t('replaySmallTag')) + '</em>' : '') + (b.capacity && b.people > b.capacity ? ' <em class="over">' + esc(t('replayOverTag')) + '</em>' : '') + '</span></li>').join('');
  return '<h3 class="replayNow">' + esc(dayLabel(day.date, day.weekday, locale) + ' ' + clockText(minute)) + '</h3>'
    + '<p class="small">' + esc(fill(t('replayInUseCount'), { rooms: new Set(frame.in_use.map(b => b.room_id)).size })) + '</p>'
    + (rows ? '<ul class="replayList">' + rows + '</ul>' : '<p class="insightEmpty">' + esc(t('replayNone')) + '</p>')
    + (frame.no_show.length ? '<p class="small">' + esc(fill(t('replayNoShowCount'), { count: frame.no_show.length })) + '</p>' : '')
    + '<p class="small replayOffMap">' + esc(fill(t('replayOffMap'), { multi: frame.multi_booth, single: frame.single_booth })) + '</p>'
    + '<p class="small replayLegend"><span class="dot live"></span>' + esc(t('replayLegendLive')) + '　<span class="dot small"></span>' + esc(t('replayLegendSmall')) + '</p>';
}

export function renderReplayShell(summary, date, minute, mode, t, locale) {
  if (!summary || summary.source !== 'enterprise_sample') return '<div class="replayUnavailable"><h3>' + esc(t('replayUnavailableTitle')) + '</h3><p>' + esc(t('replayUnavailable')) + '</p></div>';
  const options = summary.days.map(d => '<option value="' + esc(d.date) + '"' + (d.date === date ? ' selected' : '') + '>'
    + esc(dayLabel(d.date, d.weekday, locale) + ' ' + fill(t('replayDayOption'), { used: d.used }) + (d.date === summary.busiest ? ' ★' : '')) + '</option>').join('');
  return '<div class="replayBoard">'
    + '<div class="replayControls"><label class="replayDateLabel"><span>' + esc(t('replayDate')) + '</span><select id="replayDate" data-replay-date="1">' + options + '</select></label>'
    + '<button type="button" id="replayPlay" class="primary" data-replay-play="1">' + esc(t('replayPlay')) + '</button>'
    + '<label class="replayTimeLabel"><span>' + esc(t('replayTime')) + ' <output id="replayClock">' + clockText(minute) + '</output></span>'
    + '<input id="replayTime" data-replay-time="1" type="range" min="' + REPLAY_START + '" max="' + REPLAY_END + '" step="' + REPLAY_STEP + '" value="' + minute + '"' + (mode === 'trend' ? ' disabled' : '') + '></label>'
    + '<div class="replayModes" role="group"><button type="button" data-replay-mode="day" aria-pressed="' + (mode === 'day') + '">' + esc(t('replayModeDay')) + '</button>'
    + '<button type="button" data-replay-mode="trend" aria-pressed="' + (mode === 'trend') + '">' + esc(t('replayModeTrend')) + '</button></div></div>'
    + '<div class="insightStage replayStage"><div class="insightMapPane" id="replayMap"></div><div class="insightSide" id="replaySide"></div></div></div>';
}

export function createReplayUI({ document, api, perform, getText, getLocale, isActive, setPager, setIntervalFn = (...a) => setInterval(...a), clearIntervalFn = id => clearInterval(id) }) {
  const $ = id => document.getElementById(id), t = key => getText()(key);
  let summary = null, day = null, date = null, minute = 10 * 60, mode = 'day', timer = null;
  function metrics() {
    if (!summary || summary.source !== 'enterprise_sample') return [];
    if (mode === 'trend') { const tr = summary.trend; return [[t('replayMetricUsed3m'), tr.used.toLocaleString()], [t('replayMetricSmall'), tr.small_percent + '%'], [t('replayMetricFree'), tr.free_percent + '%']]; }
    const s = dayStats(day);
    return [[t('replayMetricDayUsed'), s.used], [t('replayMetricPeak'), s.peak], [t('replayMetricDaySmall'), s.big ? Math.round(s.small / s.big * 100) + '%' : '—']];
  }
  function renderMetrics() {
    const m = metrics();
    $('adminMetrics').hidden = !m.length; $('adminMetrics').innerHTML = m.map(([label, value]) => '<div class="metric"><span>' + esc(label) + '</span><b>' + esc(value) + '</b></div>').join('');
  }
  function renderFrame() {
    if (!isActive() || !$('replayMap')) return;
    $('replayMap').innerHTML = renderReplayMap(mode, summary, day, minute, t, getLocale());
    $('replaySide').innerHTML = renderReplaySide(mode, summary, day, minute, t, getLocale());
    if ($('replayClock')) $('replayClock').textContent = clockText(minute);
    if ($('replayTime') && Number($('replayTime').value) !== minute) $('replayTime').value = String(minute);
    if ($('replayPlay')) $('replayPlay').textContent = t(timer ? 'replayPause' : 'replayPlay');
    renderMetrics();
  }
  function render() {
    if (!isActive()) return;
    $('adminResults').innerHTML = renderReplayShell(summary, date, minute, mode, t, getLocale());
    setPager?.(1);
    if (summary?.source === 'enterprise_sample' && day) renderFrame(); else renderMetrics();
  }
  async function loadDay(next) { day = await api('replay/day?date=' + encodeURIComponent(next)); date = next; minute = peakMinute(day); }
  async function load() {
    stop();
    summary = await api('replay');
    if (summary.source === 'enterprise_sample' && summary.busiest) await loadDay(date && summary.days.some(d => d.date === date) ? date : summary.busiest);
    render();
  }
  function stop() { if (timer) { clearIntervalFn(timer); timer = null; } if ($('replayPlay')) $('replayPlay').textContent = t('replayPlay'); }
  function play() {
    if (timer) { stop(); return; }
    if (mode !== 'day') { mode = 'day'; render(); }
    if (minute >= REPLAY_END) minute = REPLAY_START;
    timer = setIntervalFn(() => {
      if (!isActive()) { stop(); return; }
      minute += REPLAY_STEP;
      if (minute >= REPLAY_END) { minute = REPLAY_END; stop(); }
      renderFrame();
    }, 700);
    renderFrame();
  }
  $('adminResults').addEventListener('input', event => {
    if (!isActive() || !event.target?.dataset?.replayTime) return;
    stop(); minute = Number(event.target.value); renderFrame();
  });
  $('adminResults').addEventListener('change', event => {
    if (!isActive() || !event.target?.dataset?.replayDate) return;
    stop(); const next = event.target.value;
    perform(async () => { await loadDay(next); render(); });
  });
  $('adminResults').addEventListener('click', event => {
    if (!isActive()) return;
    if (event.target.closest('[data-replay-play]')?.dataset.replayPlay) { play(); return; }
    const modeButton = event.target.closest('[data-replay-mode]');
    if (modeButton?.dataset.replayMode && modeButton.dataset.replayMode !== mode) { stop(); mode = modeButton.dataset.replayMode; render(); }
  });
  return { load, render, stop, isActive };
}
