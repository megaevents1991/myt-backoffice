// MEGA CLUB members as CSV - the file Zoho Campaigns will import in phase 2 (spec §10). Pure.
import type { ClubMemberRow } from "@/lib/club/types";

const HEADER = [
  "member_no",
  "first_name",
  "last_name",
  "email",
  "phone",
  "joined_at",
  "source",
  "marketing",
  "status",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "code",
] as const;

const israelMinute = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Jerusalem",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "2026-11-03 01:30" in Israel time. */
export function israelDateTime(iso: string): string {
  const parts = Object.fromEntries(israelMinute.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

/** A text value typed on the public form that starts like a formula (= + - @, tab, CR) is prefixed with ' so Excel /
 *  Sheets show it as text and never run it. Numbers (member_no) pass as they are. */
function cell(v: string | number | null | undefined): string {
  let s = v == null ? "" : String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function membersCsv(rows: ClubMemberRow[]): string {
  const lines = [HEADER.join(",")];
  for (const m of rows) {
    lines.push(
      [
        m.member_no,
        m.first_name,
        m.last_name,
        m.email,
        m.phone,
        israelDateTime(m.created_at),
        m.source,
        m.marketing,
        m.status,
        m.utm_source,
        m.utm_medium,
        m.utm_campaign,
        m.coupon_code,
      ]
        .map(cell)
        .join(","),
    );
  }
  return "﻿" + lines.join("\r\n");
}
