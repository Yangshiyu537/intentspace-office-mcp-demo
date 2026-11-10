// Local-only replay of the supplied Bitkey reservation sample on the meeting-room floor.
// Privacy: only room, time, booked headcount and use status leave this module; no reservation,
// person or organisation IDs. Never bundle the source CSV into public assets or send it to a model.
//
// Time zone: the time columns are named *_jst but their values end in "UTC". Used bookings start
// mostly between 10:00 and 17:00 as written, which would be 19:00-02:00 in Japan if the values
// were UTC. The written wall-clock time is therefore treated as Japan time (to be confirmed by Bitkey).

export const REAL_ROOM_MAP = {
  '会議室A': 'tsg-room-a', '会議室B': 'tsg-room-b', '会議室C': 'tsg-room-c', '会議室D': 'office-c04', '会議室E': 'office-m02',
  '会議室F': 'tsg-room-f', '会議室G': 'tsg-room-g', '会議室I': 'tsg-room-i', '会議室X': 'tsg-room-x'
};
// Smaller spaces that can host a small meeting but are not drawn on the meeting-room floor.
const SMALL_ALTERNATIVES = ['会議室A', '会議室D', ...[1, 2, 3, 4, 5, 6].map(n => 'Multi Booth 0' + n)];
export const REPLAY_RULE = { max_people: 4, max_capacity_ratio: 0.5, min_capacity: 8 };

const truthy = value => String(value).trim().toLowerCase() === 'true';
// "2026-03-04 10:30:00 UTC" -> {date:'2026-03-04', minute:630}
export function wallClock(text) {
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/.exec(String(text ?? '').trim());
  return match ? { date: match[1], minute: Number(match[2]) * 60 + Number(match[3]) } : null;
}
export function classifyBooking(row) {
  // Same basis as the poster analysis: used and not deleted afterwards.
  if (truthy(row.is_used) && !truthy(row.deleted)) return 'used';
  if (String(row.reservation_status ?? '').startsWith('4_') && !truthy(row.deleted)) return 'no_show';
  return null; // cancelled before or after the start: not shown on the map
}
const offMapGroup = name => /^Multi Booth/.test(name) ? 'multi_booth' : /^(Personal|Single) Booth/.test(name) ? 'single_booth' : null;
const weekday = date => new Date(date + 'T00:00:00Z').getUTCDay();

export function createRealReplay(rows) {
  const bookings = [], offMap = [], trendRows = [], invalid = { time: 0, people: 0 };
  for (const row of rows) {
    const status = classifyBooking(row);
    if (!status) continue;
    const name = String(row.space_name ?? '').trim(), start = wallClock(row.base_condition_start_time_jst), end = wallClock(row.base_condition_end_time_jst);
    const people = Number(row.total_people_count), capacity = Number(row.capacity);
    if (!Number.isInteger(people) || people < 1) { invalid.people++; continue; }
    // The trend counts every used booking (same basis as the poster); drawing needs a valid time window.
    if (status === 'used' && REAL_ROOM_MAP[name] && Number.isInteger(capacity))
      trendRows.push({ room_id: REAL_ROOM_MAP[name], name: name.replace('会議室', ''), capacity, people,
        date: start?.date ?? null, start: start?.minute ?? null, end: end?.minute ?? null, timed: Boolean(start && end && end.date === start.date && end.minute > start.minute) });
    if (!start || !end || end.date !== start.date || end.minute <= start.minute) { invalid.time++; continue; }
    const record = { date: start.date, start: start.minute, end: end.minute, people, capacity: Number.isInteger(capacity) ? capacity : null, status, space: name };
    if (REAL_ROOM_MAP[name]) bookings.push({ ...record, room_id: REAL_ROOM_MAP[name], name: name.replace('会議室', '') });
    else if (offMapGroup(name)) offMap.push({ ...record, group: offMapGroup(name) });
  }
  const occupancy = new Map();
  for (const b of [...bookings, ...offMap]) if (SMALL_ALTERNATIVES.includes(b.space)) (occupancy.get(b.space) ?? occupancy.set(b.space, []).get(b.space)).push(b);
  const capacityOf = new Map([...bookings, ...offMap].filter(b => b.capacity).map(b => [b.space, b.capacity]));
  const smallParty = b => b.capacity >= REPLAY_RULE.min_capacity && b.people <= REPLAY_RULE.max_people && b.people / b.capacity <= REPLAY_RULE.max_capacity_ratio;
  const freeSmaller = b => SMALL_ALTERNATIVES.some(space => (capacityOf.get(space) ?? 0) >= b.people
    && !(occupancy.get(space) ?? []).some(o => o.date === b.date && o.start < b.end && b.start < o.end));

  const byDate = new Map();
  for (const b of bookings) (byDate.get(b.date) ?? byDate.set(b.date, []).get(b.date)).push(b);
  const offByDate = new Map();
  for (const b of offMap) (offByDate.get(b.date) ?? offByDate.set(b.date, []).get(b.date)).push(b);
  const days = [...byDate.keys()].sort().map(date => {
    const list = byDate.get(date), used = list.filter(b => b.status === 'used');
    return { date, weekday: weekday(date), used: used.length, no_show: list.length - used.length, peak: peakConcurrent(used) };
  }).filter(day => day.used > 0);
  const busiest = [...days].sort((a, b) => b.used - a.used || b.peak - a.peak || a.date.localeCompare(b.date))[0]?.date ?? null;

  // Three-month trend with the same thresholds as the in-app review rule.
  const big = trendRows.filter(b => b.capacity >= REPLAY_RULE.min_capacity);
  const rooms = [...new Set(big.map(b => b.room_id))].map(room_id => {
    const list = big.filter(b => b.room_id === room_id), small = list.filter(smallParty);
    const small24 = small.filter(b => b.people >= 2), checked = small.filter(b => b.timed), free = checked.filter(freeSmaller);
    return { room_id, name: list[0].name, capacity: list[0].capacity, used: list.length, small: small.length,
      small_percent: Math.round(small.length / list.length * 1000) / 10, small_2to4: small24.length,
      small_2to4_percent: Math.round(small24.length / list.length * 1000) / 10, free_checked: checked.length, free_smaller: free.length };
  }).sort((a, b) => b.small_percent - a.small_percent);
  const totalSmall = rooms.reduce((n, r) => n + r.small, 0), totalBig = rooms.reduce((n, r) => n + r.used, 0);
  const trend = { rule: REPLAY_RULE, used: totalBig, small: totalSmall, small_percent: totalBig ? Math.round(totalSmall / totalBig * 1000) / 10 : 0,
    free_checked: rooms.reduce((n, r) => n + r.free_checked, 0), free_smaller: rooms.reduce((n, r) => n + r.free_smaller, 0), rooms };
  trend.free_percent = trend.free_checked ? Math.round(trend.free_smaller / trend.free_checked * 1000) / 10 : 0;

  return {
    summary() {
      return { source: 'enterprise_sample', local_only: true, coverage: days.length ? { start: days[0].date, end: days.at(-1).date } : null,
        days, busiest, trend, invalid, time_basis: 'written_wall_clock_as_jst',
        limitations: ['Booked headcount, not measured attendance.', 'Registered capacity may be inaccurate (supplier note).',
          'Equipment is not checked for free smaller rooms.', 'Times are treated as Japan time although labelled UTC; to be confirmed.'] };
    },
    day(date) {
      if (!byDate.has(date)) return null;
      const strip = ({ space, alternative, ...rest }) => rest;
      return { date, weekday: weekday(date), bookings: byDate.get(date).map(strip).sort((a, b) => a.start - b.start || a.name.localeCompare(b.name)),
        off_map: (offByDate.get(date) ?? []).map(({ group, start, end, people, status }) => ({ group, start, end, people, status })) };
    }
  };
}

function peakConcurrent(list) {
  const edges = list.flatMap(b => [[b.start, 1], [b.end, -1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let now = 0, peak = 0;
  for (const [, d] of edges) { now += d; peak = Math.max(peak, now); }
  return peak;
}

// What the map shows at one minute of the day.
export function replayFrame(day, minute) {
  const active = day.bookings.filter(b => b.start <= minute && minute < b.end);
  return { minute, in_use: active.filter(b => b.status === 'used'), no_show: active.filter(b => b.status === 'no_show'),
    off_map: { multi_booth: day.off_map.filter(b => b.group === 'multi_booth' && b.status === 'used' && b.start <= minute && minute < b.end).length,
      single_booth: day.off_map.filter(b => b.group === 'single_booth' && b.status === 'used' && b.start <= minute && minute < b.end).length } };
}
