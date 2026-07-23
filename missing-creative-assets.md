# Missing artists & football logos — for campaign creative auto-generation

Generated 2026-07-17 from live production data. 138 events currently fall back
to their original card image in the Meta feed because the auto-creative
generator can't identify both sides of the match or find the artist. Fixing
these unlocks branded campaign images for those events automatically
(next nightly run picks them up — no other action needed after upload).

**Where to upload:**
- Artists → Templates → Artists (name + image)
- Football clubs/logos → Assets → Football Logo Library (name + logo)

Match by the exact club/artist name (Hebrew or English — either is enough)
so the auto-matcher finds it.

---

## 🎤 Missing artists — 8 artists / 14 events

| Artist | Events |
|---|---|
| Noah Kahan | 6 |
| ASAP Rocky | 1 |
| Art Garfunkel | 1 |
| Anastacia | 1 |
| Jay-Z | 1 |
| David Guetta | 1 |
| Jack Harlow | 1 |
| Jerry Seinfeld | 1 |

## ⚽ Missing football clubs/logos — ~85 clubs / ~120 events

Current logo library has only 18 teams (national teams + 8 marquee clubs).
Priority: fix leagues top-to-bottom for the biggest win per upload.

### Premier League — 17 clubs × 3 events each (~50 events, do first)
Leeds United, Everton, Bournemouth, Manchester United, Ipswich Town,
Brentford, Newcastle United, Liverpool, Crystal Palace, Sunderland,
Aston Villa, Nottingham Forest, Coventry City, Hull City, Manchester City,
Fulham, Brighton & Hove Albion

### La Liga — 16 clubs × 2 events each
Villarreal, Sevilla, Celta Vigo, Deportivo Alavés, Osasuna, Getafe, Levante,
Real Betis, Valencia, Espanyol, Elche, Racing Santander, Deportivo La Coruña,
Athletic Bilbao, Real Sociedad, Málaga

### Serie A — 17 clubs × 1-2 events each
Como, Atalanta, Bologna, Lecce, Napoli, Udinese, Parma, Genoa, Torino,
Sassuolo, Juventus, Venezia, Cagliari, Frosinone, Roma, Lazio, Fiorentina

### Eredivisie (Netherlands) — 15 clubs × 1 event each
PSV Eindhoven, Willem II, Excelsior Rotterdam, NEC Nijmegen, AZ Alkmaar,
ADO Den Haag, FC Utrecht, FC Groningen, SC Telstar, Go Ahead Eagles,
Feyenoord, PEC Zwolle, FC Twente, Fortuna Sittard, Sparta Rotterdam

---

## Not fixable by upload (2 events)

World Cup bracket placeholders where finalists aren't decided yet —
"גמר מונדיאל 2026" (final) and "Loser of Match 102". These resolve
automatically once real team names are set closer to the tournament.
