'use strict';
/* cast.js: the starter cast's file names. The cast is numbered (cast-01.png
   and up) so it suggests no names or roles. The nine original standees had
   names; aa.conf files written with those keep working through this map. */

const CAST_ALIASES = Object.freeze({
  'cody.png': 'cast-01.png', 'derek.png': 'cast-02.png', 'eric.png': 'cast-03.png', 'lila.png': 'cast-04.png', 'maya.png': 'cast-05.png',
  'priya.png': 'cast-06.png', 'quinn.png': 'cast-07.png', 'scrum-master.png': 'cast-08.png', 'stacey.png': 'cast-09.png'
});

function castFile(name) { return CAST_ALIASES[name] || name; }

/* The order the pickers show the cast in. File numbers follow the order the
   pictures arrived, which front-loads the original nine; this order mixes
   the cast so no row reads as one kind of person. Files not listed here
   follow, by name. */
const CAST_ORDER = Object.freeze([
  'cast-17.png', 'cast-06.png', 'cast-15.png', 'cast-11.png', 'cast-03.png', 'cast-14.png',
  'cast-23.png', 'cast-13.png', 'cast-20.png', 'cast-12.png', 'cast-16.png', 'cast-01.png',
  'cast-19.png', 'cast-05.png', 'cast-22.png', 'cast-09.png', 'cast-24.png', 'cast-10.png',
  'cast-18.png', 'cast-07.png', 'cast-21.png', 'cast-04.png', 'cast-02.png', 'cast-08.png'
]);

function castSort(files) {
  const rank = (f) => { const i = CAST_ORDER.indexOf(f); return i < 0 ? CAST_ORDER.length : i; };
  return [...files].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

module.exports = { CAST_ALIASES, CAST_ORDER, castFile, castSort };
