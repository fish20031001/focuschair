// Statistics over session records (record.date is epoch ms), matching
// Stats.swift. Days are local calendar days; weeks start on Sunday, as
// Calendar.current does in Taiwan.

export function startOfDay(date) {
  const d = new Date(date);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(date, days) {
  const d = startOfDay(date);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}

export function sameDay(a, b) {
  return startOfDay(a).getTime() === startOfDay(b).getTime();
}

export function minutesOn(records, day) {
  return records
    .filter((r) => r.success && sameDay(r.date, day))
    .reduce((sum, r) => sum + r.minutes, 0);
}

export function minutesThisWeek(records, now, firstWeekday = 0) {
  const today = startOfDay(now);
  const start = addDays(today, -((today.getDay() - firstWeekday + 7) % 7));
  const end = addDays(start, 7);
  return records
    .filter((r) => r.success && r.date >= start.getTime() && r.date < end.getTime())
    .reduce((sum, r) => sum + r.minutes, 0);
}

/** Consecutive days with a success, ending today, or yesterday if today has none yet. */
export function streak(records, now) {
  const days = new Set(records.filter((r) => r.success).map((r) => startOfDay(r.date).getTime()));
  let day = startOfDay(now);
  if (!days.has(day.getTime())) day = addDays(day, -1);
  let count = 0;
  while (days.has(day.getTime())) {
    count += 1;
    day = addDays(day, -1);
  }
  return count;
}

/** Share of sessions that succeeded over the last `days` calendar days; null when none. */
export function successRate(records, now, days = 7) {
  const start = addDays(now, -(days - 1)).getTime();
  const recent = records.filter((r) => r.date >= start && r.date <= now);
  if (recent.length === 0) return null;
  return recent.filter((r) => r.success).length / recent.length;
}

/** Successful minutes per day for the last `count` days, oldest first. */
export function lastDays(records, now, count = 7) {
  const result = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const day = addDays(now, -offset);
    result.push({ day, minutes: minutesOn(records, day) });
  }
  return result;
}
