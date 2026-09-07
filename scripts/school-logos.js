// Maps a team name — either a conference school ("Becton", "PCSST") or an
// opponent as DigitalSports writes it ("Hawthorne High School") — to the slug of
// its logo file in images/logos/optimized/. Out-of-conference opponents return
// null (no crest). Order matters: more specific keys are checked first so
// "Hawthorne Christian" never resolves to plain Hawthorne.
function norm(s) { return String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, ''); }

// [slug, [identifying normalized substrings]] — evaluated top to bottom.
var SCHOOLS = [
  ['hawthorne-christian', ['hawthornechristian']],
  ['eastern-christian', ['easternchristian']],
  ['saint-mary', ['saintmary', 'stmary']],
  ['saddle-river-day', ['saddleriver']],
  ['saddle-brook', ['saddlebrook']],
  ['becton', ['becton']],
  ['bogota', ['bogota']],
  ['butler', ['butler']],
  ['cresskill', ['cresskill']],
  ['dwight-englewood', ['dwight']],
  ['elmwood-park', ['elmwood']],
  ['emerson', ['emerson']],
  ['garfield', ['garfield']],
  ['glen-rock', ['glenrock']],
  ['hasbrouck-heights', ['hasbrouck', 'hasbrou']],
  ['hawthorne', ['hawthorne']],
  ['leonia', ['leonia']],
  ['lodi', ['lodi']],
  ['lyndhurst', ['lyndhurst']],
  ['manchester-regional', ['manchester']],
  ['mary-help', ['maryhelp']],
  ['midland-park', ['midland']],
  ['new-milford', ['newmilford']],
  ['north-arlington', ['northarlington']],
  ['palisades-park', ['palisades']],
  ['park-ridge', ['parkridge']],
  ['pcsst', ['pcsst', 'patersoncharter']],
  ['pompton-lakes', ['pompton']],
  ['ridgefield-memorial', ['ridgefield']],
  ['rutherford', ['rutherford']],
  ['secaucus', ['secaucus']],
  ['waldwick', ['waldwick']],
  ['wallington', ['wallington']],
  ['weehawken', ['weehawken']],
  ['wood-ridge', ['woodridge']],
];

function logoSlug(name) {
  var k = norm(name);
  if (!k) return null;
  for (var i = 0; i < SCHOOLS.length; i++) {
    var keys = SCHOOLS[i][1];
    for (var j = 0; j < keys.length; j++) {
      if (k.indexOf(keys[j]) >= 0) return SCHOOLS[i][0];
    }
  }
  return null;
}
module.exports = { logoSlug, norm };
