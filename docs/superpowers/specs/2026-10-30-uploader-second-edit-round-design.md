# AI Uploader - the second-edit round (30.10.2026)

Source: Alon's note on the 29.10 brief (card up-second-edit), relayed by the feature-brief session:
"עריכה ראשונה עבדה ממש טוב. עריכה שנייה הוא לא שאל אותי כבר אם להחיל את הדברים לכל האירועים - אולי כדאי שלי יהיה דרך לתת
לזה טריגר? או פשוט לוודא שתמיד אחרי עריכה יקפוץ השאלות. וגם ערכתי דיסקריפשיין הוא לחלק החיל את זה ולחלק לא."
Dor (relayed, quoted): "יאלה בוא נתחיל לעבוד על התיקונים?" - the five items below.

## What the data showed (Oasis run 2e7481b9, read-only)

- The first learn (09:44Z, event 1304) worked: the hall and the LiveTickets descriptions reached 5 shows, 6 tickets.
- The second edit (14:56Z, event 1303) changed only `location.name` and the EVENT's description. `editKindsOf` watches neither, so
  step 2 stayed locked under "אחרי השמירה בעורך הכפתור נפתח". The repo's own check over the live rows answers [] on all six shows;
  in memory a TixStock zone or a LiveTickets description does light it, a ticket rename or a LiveTickets zone does not.
- No write of the system ever carried an event description. 1303, 1305, 1306, 1307 were typed by Alon (audit: his saves); 1308 was
  approved with the old "ללונדון". What "לחלק החיל" meant is not confirmed with him - the dialog shows the reason per show either way.
- `description` is not in `EDIT_WHITELIST`, so 1305-1307 were approved `edited: false`.

## The five items

1. **The button never locks (his "trigger").** "למדו והחילו" opens the dialog at any moment, on any built card with another built
   show. The dialog says what changed, what it cannot carry, or that it found nothing. Only `busy` disables it.
2. **The question after a save (his "always").** After an admin saves an event of an uploader run in the editor and there is something
   to carry, a toast asks "להחיל על N ההופעות?" and opens the board at that card's dialog (`/uploader/<run>?learn=<item>`), in a new tab.
   `learnPromptForEvent` never throws and never fails the save; a non-admin gets nothing (the board is admin-only).
3. **Two new kinds in the dialog.**
   - `event_description`: the event's own description. A show gets it only at the same hall (`sameVenue`) AND while its description still
     reads what the source's read before the edit, AND it is untouched (equal to its own baseline). Same hall + same old text is what
     keeps a football run safe: Lazio's texts each name another opponent, so nothing is carried and the dialog points at "תבנית תיאור".
     A cleared description is not carried (no bulk blanking of live events).
   - `place`: `location`, `event_location`, `lodging_mode`, `lodging_default`, `lodging_note`, `split_default_nights` - only the fields
     that changed, same hall, untouched, same start. A changed flight city (`location.city_iata`) is not carried: it changes flights
     and the base prices. The dialog says so.
   A person's carried text stays a person's: the item's payload gets `description_by_hand: true`, and `rewriteRunDescriptions` (the names
   and classification confirms, the board's template apply) leaves it, counted as `editedByHand` - without the flag, a later classify
   would silently overwrite it, because the baseline now equals it.
4. **A reason per show.** The dialog lists every other built show with a verdict per kind: applies / other hall / typed by hand /
   different text / already the same / no such category. A partly applied ticket pass says so ("2 כרטיסים · חלק הוקלד ידנית").
   Edits nothing carries (dates, prices, a ticket renamed, a LiveTickets zone, a TixStock description cleared, a new flight city, a blank
   description) are listed as "לא מוחל".
5. **A typed description counts as an edit.** `description` joins `EDIT_WHITELIST` and `EDIT_EVENT_COLUMNS`: the card's "נערך" tag, the
   approve flag and the `uploader.edited` lesson read it. A rewrite's payload follows, so the uploader's own text is no edit.

## Rulings

- The round-3 ruling "the event's description is not a kind" is reversed: its reason (a template rewrite would refill it) is handled by
  `description_by_hand`.
- Nothing forces a skipped show: a person who wants it there types it (never overwrite what someone typed - the round-3 rule).
- Writes go straight to the columns (`writeEventFields`), never through `updateEvent`, audited as an `update` of the event with
  from / to, and the show's payload follows. `uploader.learned_fields` records the pass.
- A kind cut by the budget or with a failed write stays pending on the source (no rebase), "החל" again finishes it - as the two older kinds.
- No migration. Nothing on myt-main. The five live items (1308, 1303, 1296, 1299, 1285) are left alone - Dor decides them separately.

## Review (30.10, before the commit)

An independent review found twelve points. Fixed: (1) `sameVenue` was true on a shared drawing alone, and TixStock hands "General Admission.svg" to
244 venues - a second city or a transfer note could reach a live show in another city. A hall now needs the same venue name, plus the same drawing or the same
city; this also tightens the round-3 ticket-description `set`. (2) A flight city that went empty, or that a ticket-only show was given, read as no change and
was carried: `flightChanged` now compares through empty. (3) A learn erased the edit: the payload now keeps `built_fields`, read by `editDiff` (as
`built_tickets_count`), so "נערך", the approve flag and the lesson survive. (5) The toast promised every show of the run and repeated on every later save: it now
counts the shows a kind really reaches (`showsReached`; none = no toast) and fires only when this save touched a carried field (`editTouchesLearnFields`).
(6) Applying at zero reach reported success and cleared the edit: a kind no show would take stays unticked and pending, its reasons shown, and the toast no longer
says "0 shows". (7) `description_by_hand` no longer lands on an `already` nobody typed, and a template fill drops it. (8) A description compares trimmed in `editDiff`.
(9) A LiveTickets ticket added or removed is named under "not carried"; the flight-city line says the lodging stays behind too. (10) The hall kind's skip reads
"שרטוט אחר". (11) The toast title has no Latin text.
Left, known: (4) a stale editor tab saving old values over a carried text reads as a new edit, and the dialog offers it (whole-form saves through `updateEvent`
are older than this round, and the dialog shows the text before anyone applies it); (12) a save in another tab while the dialog is open means "החל" carries the newer text.

## Addendum 31.10: LiveTickets zones and deleted categories (Fulham - Newcastle, event 1228)

The round left these under "not carried". Event 1228 showed the cost: the card read "edited" (10 tickets -> 8), the dialog said it found nothing, and the second press did
nothing either. They are the kind `live_tickets` now: a zone set or moved reaches the same hall on the same map, a deleted category the same hall; the hall remembers the deleted
categories for the next build (`dropped_categories.livetickets`). A category added and a zone cleared stay "not carried". See "LiveTickets zones and deleted categories" in CLAUDE.md.
