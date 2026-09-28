'use strict';
/* cast.js: the starter cast's file names. The cast is numbered (cast-01.png
   and up) so it suggests no names or roles. The nine original standees had
   names; aa.conf files written with those keep working through this map. */

const CAST_ALIASES = Object.freeze({
  'cody.png': 'cast-01.png', 'derek.png': 'cast-02.png', 'eric.png': 'cast-03.png', 'lila.png': 'cast-04.png', 'maya.png': 'cast-05.png',
  'priya.png': 'cast-06.png', 'quinn.png': 'cast-07.png', 'scrum-master.png': 'cast-08.png', 'stacey.png': 'cast-09.png'
});

function castFile(name) { return CAST_ALIASES[name] || name; }

module.exports = { CAST_ALIASES, castFile };
