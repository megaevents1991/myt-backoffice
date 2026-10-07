/**
 * A customer's answers on a feedback form, read as a review the site can quote.
 *
 * The feedback forms (public.forms, /forms) ask for star ratings and one or more
 * free texts. Staff pick the answers worth showing in Website > Homepage > Reviews;
 * a picked answer is COPIED into the section (name, text, stars), so what the site
 * shows is exactly what staff approved and can still shorten - a later edit or
 * removal of the answer itself never changes the site.
 *
 * Pure - no server or browser imports. The action that loads the answers is
 * lib/actions/tours-form-reviews-actions.ts.
 */
import { REVIEW_TEXT_MAX } from "@/lib/tours/site-content";

/** One question of a form, as far as a review needs it. */
export interface FormReviewField {
  id: number;
  type: string;
  position: number;
  staffOnly: boolean;
  /** A rating that counts for the form's own review score (config.review_score). */
  reviewScore: boolean;
  /** The top of a rating's scale (config.max); 5 when the form does not say. */
  max: number;
}

/** Which questions of a form make a review: who wrote it, the stars, the texts, and the trip it is about. */
export interface FormReviewShape {
  name: FormReviewField | null;
  rating: FormReviewField | null;
  texts: FormReviewField[];
  trip: FormReviewField[];
}

export interface FormReviewCandidate {
  /** The answer's id (public.form_responses.id). */
  id: number;
  name: string;
  text: string;
  /** 1-5, or 0 when the customer gave no stars. */
  rating: number;
  /** When it was sent (ISO). */
  date: string;
  /** What staff filled in about the trip (leader, departure day, trip code), joined for display. */
  trip: string;
}

/** The mark a picked review carries, so the picker can show it as already taken. */
export const formReviewRef = (responseId: number): string => `form:${responseId}`;

/**
 * The questions a review is read from, by the form's own structure - no question is
 * named in code, so a copy of the form or a new one works the same way:
 *  - who wrote it: the first short text the customer fills in;
 *  - the stars: the first rating that counts for the review score, else the first rating;
 *  - the text: every long text the customer fills in;
 *  - the trip: the short texts and dates staff fill in (the leader, the departure day).
 */
export function formReviewShape(fields: FormReviewField[]): FormReviewShape {
  const ordered = [...fields].sort((a, b) => a.position - b.position || a.id - b.id);
  const own = ordered.filter((f) => !f.staffOnly);
  const ratings = own.filter((f) => f.type === "rating");
  return {
    name: own.find((f) => f.type === "short_text") ?? null,
    rating: ratings.find((f) => f.reviewScore) ?? ratings[0] ?? null,
    texts: own.filter((f) => f.type === "long_text"),
    trip: ordered.filter((f) => f.staffOnly && (f.type === "short_text" || f.type === "date")),
  };
}

/** A form can feed reviews when it asks its customers for at least one free text. */
export const canFeedReviews = (shape: FormReviewShape): boolean => shape.texts.length > 0;

const answerText = (answers: Record<string, unknown>, field: FormReviewField | null): string => {
  if (!field) return "";
  const value = answers[String(field.id)];
  return typeof value === "string" ? value.trim() : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
};

/** A date answer (yyyy-mm-dd) as dd.mm.yyyy; anything else as it is. */
const shownDay = (value: string): string => (/^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split("-").reverse().join(".") : value);

/** Stars out of 5, whatever scale the form used; 0 when there is no answer. */
function starsOf(answers: Record<string, unknown>, field: FormReviewField | null): number {
  if (!field) return 0;
  const value = Number(answers[String(field.id)]);
  if (!Number.isFinite(value) || value <= 0) return 0;
  const max = field.max > 0 ? field.max : 5;
  return Math.min(5, Math.max(1, Math.round((value / max) * 5)));
}

/**
 * One answer as a review, or null when the customer wrote no text (stars alone are
 * not a review). `tripLabel` = what the trip link itself says (its code or name).
 */
export function formReviewCandidate(
  shape: FormReviewShape,
  response: { id: number; answers: unknown; submittedAt: string },
  tripLabel = "",
): FormReviewCandidate | null {
  const answers = response.answers && typeof response.answers === "object" && !Array.isArray(response.answers) ? (response.answers as Record<string, unknown>) : {};
  const text = shape.texts
    .map((field) => answerText(answers, field))
    .filter(Boolean)
    .join("\n")
    .slice(0, REVIEW_TEXT_MAX);
  if (!text) return null;
  const trip = [tripLabel.trim(), ...shape.trip.map((field) => shownDay(answerText(answers, field)))].filter(Boolean);
  return {
    id: response.id,
    name: answerText(answers, shape.name),
    text,
    rating: starsOf(answers, shape.rating),
    date: response.submittedAt,
    trip: [...new Set(trip)].join(" · "),
  };
}
