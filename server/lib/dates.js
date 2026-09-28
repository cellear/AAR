'use strict';
/* dates.js: calendar dates in the machine's local time zone. AAR stamps files
   and compares deadlines by the day the user sees on their clock, never UTC,
   which is tomorrow for an American evening. */

function pad(n) { return String(n).padStart(2, '0'); }

/* YYYY-MM-DD for a Date, in local time. */
function localISODate(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(d, days) {
  const out = new Date(d.getTime());
  out.setDate(out.getDate() + days);
  return out;
}

module.exports = { localISODate, addDays };
