# AI Uploader - Alon round 3 (29.10.2026)

Source: Alon's notes on the 28.10 feature report (https://claude.ai/artifact/EMdcn6UVQZfnmK2zbQSShe), relayed by
the feature-brief session. Dor took the three recommended answers (29.10).

## Note 1 - the missing-page task is written for Liz and leaves the run board

Alon: "צריך כבר לכתוב מה המשימה לליז ולהעלים את זה מהלוח כי זה לא ברמת הריצה יותר."

Today "פתח משימה" (subject row + fix rows of the run panel) opens the task dialog with a title and a "from run" link,
unassigned, and the row stays on the panel after the task is saved.

- **Written task.** `PanelTask` carries `code` (the warning it answers: `no_team_page` / `no_artist_page` /
  `no_crest` / `no_bio` / `no_cutout` / `no_event_gallery`) and `steps` - what to do, in Hebrew, per code (build /
  finish the page in Templates and switch it on; upload a crest; write a bio; upload a cut-out; upload event
  pictures), with the page's link. The dialog's description = the steps + "N הופעות בריצה מחכות לזה" + the run link.
- **Assignee = whoever got the last such task** (`source_ref.kind = "uploader_page"`, newest with an assignee). The
  first time Alon picks Liz; it sticks with no setting screen and no hard-coded user. `TaskPrefill.assignee_id`
  (new, optional) seeds the dialog's assignee.
- **The row leaves.** `getRun` reads the `uploader_page` tasks (not deleted, not cancelled - an open OR a done task
  hides the row; the item warnings are frozen at build time, so a done task must not bring a stale row back) as
  `RunBoard.pageTasks`. A panel row is covered when a task has the same `table`, the same `code` (a task made before
  this round has no code: the same title), and the same `row_id` or the same label (the row id appears once the
  names dialog creates the page). Covered rows leave the panel, and their codes leave the cards too (neither printed
  nor folded) - in this run and in any later run of the same page. A cancelled task brings the row back.
- After the dialog saves, the board reads the run again.

## Note 2a - a second edit of a taught event is seen again

Bug: `isFixedByHand` returned false for good once the item carried `taught_venue` (ruling R20, round 1) - the
learn never rewrote its source event, so the payload kept differing and R20 used the decision as the exit.

Fix: a learn REBASES the source item's `payload` to what the event holds now - only the kinds that went through
CLEANLY (a kind the time budget cut, or with a failed write, stays pending so "החל" again finishes it; both passes are
idempotent) - and `isFixedByHand` is a plain diff against the payload again (no decision check). The payload is
already the baseline every code rewrite keeps in step. `EDIT_WHITELIST` holds `tickets_count` (the payload's ticket
count), so a rebased payload keeps the count the uploader wrote (`built_tickets_count`, set once, read by
`fieldOf`) - a category a person deleted is still their edit at approve. `templateFromEvent` still finds only NEW
drops (the rebased payload no longer holds the ones already taught; the template keeps those).

Ruling: an item taught before this round has no rebase, so it lights up again (its event still differs from the
build). One more "למד והחל" clears it - and on Alon's live Lazio run that is exactly the second learn he asked for.

## Note 2b - "what you changed", applied to the other shows (no AI)

Alon: after an edit, a line for the AI ("learn this" / "do it on every other card"); his example - he cleared the
LiveTickets ticket descriptions on every Lazio event, one by one.

Code compares the edited event with its baseline (`lib/uploader/edit-changes.ts`, pure) and lists two kinds:

1. **Hall (venue)** - TixStock zones / categories / a new TixStock description / excluded sections: the existing
   learn (template + the hall's other shows). Needs the hall's template; when there is none the dialog says why
   (the classification dialog is the way in) and the rest still applies.
2. **LiveTickets ticket descriptions** - per category key (`normalizeSupplierCategory` of `supplierCategory ||
   category`): a description cleared, or set to new text. TixStock descriptions are NOT here: they follow the hall
   template (`inStepWithTemplate` refills an empty one from its zone), so a code clear would not stick - they go with
   the hall kind and the editor's zones board.
   - every LiveTickets description cleared on this event (and at least one was there) = clear them on every OTHER
     built show of the run (any category);
   - one category cleared = clear that category on every other built show of the run;
   - one category set to new text = that text on the shows **at the same venue** only (a seat's text describes a
     seat in one hall; a clear is a policy for the run).
   - a ticket on another show is touched only while its description still equals that show's baseline (never one a
     person typed there), and that show's payload follows (only the descriptions changed - its own hand edits stay
     visible); a ticket a person already brought to the plan's text by hand is ADOPTED (no write, the baseline
     follows), so that card stops reading as edited.
   - the hall's code rewrite (`rewriteVenueItems`, also `classifyVenue`) stores a show's new baseline with every
     LiveTickets description a person typed kept OUT of it (`keepHandDescriptions`) - otherwise the description pass
     right after it would take the typed text for the show's own and overwrite it.

The card's two learn steps show on every built card with another built show in the run (not only hall-mates), and
step 1 reads "✓" when either kind has a change. The dialog lists each kind with a checkbox (on by default) and its
count, then "החל". An unticked kind is NOT consumed: the rebase covers only the kinds applied.

**Note for the AI** (optional, 3-500 chars): saved as a taught rule of the tour uploader (`addAgentInstruction`,
`agent_instructions`) - it rides on every later call of the agent (brief, classification, names, location). The
dialog says plainly that it changes no event by itself. A note alone (nothing ticked) is allowed.

Ruling: the event's own description is NOT a kind - the description template owns it (a code clear would be refilled
by the next template rewrite, which treats an untouched description as its own). The dialog points at "תבנית תיאור".

Audit: `uploader.learned_descriptions` (item, event, what was cleared / set, events and tickets rewritten); the
venue part keeps `uploader.classified` + `uploader.classify_changed`.

## Review (29.10, before the commit)

An independent review found eight issues in the first build, all fixed before the commit: the hall rewrite took
hand-typed descriptions into a sibling's baseline (`keepHandDescriptions`); the rebase lost the `tickets_count` lesson
(`built_tickets_count`); a cut-off pass was consumed anyway (clean-only rebase); TixStock clears would be refilled by
the template (LiveTickets only); unticking a kind could still consume part of it (gone with TixStock); a partial
failure showed one "failed" toast and skipped the refresh (each part reports, the board always refreshes); shows
already cleared by hand stayed lit (adopted); a remembered assignee off the staff list showed an empty pick (dropped).
Accepted as before: a whole-column `tickets_and_rates` write can race the TixStock / LiveTickets syncs by a few seconds
(the classification path has the same exposure).
