// Plain (non-"use server") companion to price-light-actions.ts. A "use server"
// file may only export async functions - a bare `export const` there breaks
// `npm run build` ("Only async functions are allowed to be exported in a
// 'use server' file") the moment anything outside that file imports it. This
// constant is used both server-side (silenceRedLight, in price-light-actions.ts)
// and client-side (decision-actions.tsx's "מושתק עד" toast), so it lives here.

/** How long a red light stays silenced on "השאר בפיד" (`silenceRedLight`). */
export const SILENCE_DAYS = 14;
/** The longest mute a call may ask for - past this a "silence" is really a decision to drop the event. */
export const SILENCE_DAYS_MAX = 90;
/** An override note is quoted into every AI prompt as a lesson - long enough to explain, short enough to bound the bill. */
export const OVERRIDE_NOTE_MAX = 500;

/** AI calls one "בדוק עכשיו" click may spend. The nightly has a run-wide ceiling; a manual
 *  recheck has no run to belong to, so it carries its own. Four covers the competitors of both
 *  scopes for one event, which is all a single click can legitimately need. */
export const RECHECK_AI_CALLS = 4;
