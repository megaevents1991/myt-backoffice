"use client";

/**
 * One customer, every deal of theirs under them (Nir 19.10, mockup https://claude.ai/artifact/6CXvKBuoCd3np4RiD9GPG1).
 * The header is the person - phones, e-mail, national id, ACC NUM, edited once for every card. Below: inquiries
 * waiting to be filed, the open cards, then History (closed deals and trips that left). A card opens in place into
 * the card page (CasePage embedded): its orders, travelers, offer, product, gift, source and notes.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, CalendarClock, ChevronRight, GitMerge, Inbox, Link2, Loader2, Phone, PlusCircle, Star, StickyNote, TriangleAlert, UserRound, X, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useActionData } from "@/hooks/use-action-data";
import { useActionToast } from "@/hooks/use-action-toast";
import { useToast } from "@/hooks/use-toast";
import { EMPTY, fmtDate, fmtInstant, fmtPrice, todayIso } from "@/lib/tours/format";
import { dismissCustomerSuggestion, fileInquiry, getCustomerPage, updateCase, updateCustomer } from "@/lib/actions/tours-cases-actions";
import { LEAD_KIND_LABELS } from "@/types/tours.types";
import { Chip, LoadError, Notice } from "@/components/tours/ui";
import {
  customerLabel,
  customerName,
  followUpDue,
  isClosedStatus,
  isPaidStatus,
  senderDiffers,
  statusOf,
  todayReason,
  type BoardOrder,
  type CaseRow,
  type CustomerChange,
  type CustomerPageData,
} from "@/lib/tours/cases";
import { FollowUpInput, MailButton, StageBar, StatusTag, TodayBadge, WhatsAppButton } from "@/components/tours/cases/case-ui";
import { CasePage, type CardFocus } from "@/components/tours/cases/case-page";
import { NewCaseDialog } from "@/components/tours/cases/new-case-dialog";
import { MergeCustomerDialog } from "@/components/tours/cases/customer-dialogs";

/** A field of the customer header: saved when it loses focus (Enter too), Esc puts the old value back. */
function HeaderField({
  label,
  value,
  dir = "auto",
  onSave,
  inputMode,
}: {
  label: string;
  value: string | null;
  dir?: "auto" | "ltr";
  onSave: (next: string) => void;
  inputMode?: "numeric" | "email";
}) {
  return (
    <label className="grid min-w-0 gap-1 text-sm">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Input
        key={value ?? ""}
        dir={dir}
        inputMode={inputMode}
        defaultValue={value ?? ""}
        className="h-9 bg-background"
        onBlur={(e) => {
          const next = e.target.value.trim();
          if (next !== (value ?? "")) onSave(next);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            e.currentTarget.value = value ?? "";
            e.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

/** The customer's phones: the main one first (a star moves it there), a phone removed or added in place. */
function PhonesField({ phones, disabled, onSave }: { phones: string[]; disabled: boolean; onSave: (next: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const phone = draft.trim();
    if (!phone) return;
    onSave([...phones, phone]);
    setDraft("");
  };
  return (
    <div className="grid min-w-0 gap-1 text-sm">
      <span className="text-xs text-muted-foreground">Phones</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {phones.map((p, i) => (
          <span
            key={p}
            className={cn(
              "inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 font-mono text-xs tabular",
              i === 0 && "border-primary/40 bg-primary/5",
            )}
            dir="ltr"
          >
            {i === 0 ? (
              <Star className="h-3 w-3 fill-current text-primary" aria-label="main phone" />
            ) : (
              <button
                type="button"
                disabled={disabled}
                className="text-muted-foreground hover:text-primary"
                title="Make it the main phone"
                onClick={() => onSave([p, ...phones.filter((x) => x !== p)])}
              >
                <Star className="h-3 w-3" />
              </button>
            )}
            {p}
            {phones.length > 1 && (
              <button
                type="button"
                disabled={disabled}
                className="text-muted-foreground hover:text-destructive"
                aria-label={`Remove ${p}`}
                onClick={() => onSave(phones.filter((x) => x !== p))}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </span>
        ))}
        <Input
          dir="ltr"
          inputMode="tel"
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          onBlur={add}
          placeholder="+ phone"
          aria-label="Add a phone"
          className="h-7 w-32 bg-background px-2 text-xs"
        />
      </div>
    </div>
  );
}

/** Where the deal is: a departure (code · date), a season, or nothing yet. */
function cardWhen(card: CaseRow): string {
  if (card.departureCode) return `${card.departureCode}${card.departureDate ? ` · ${fmtDate(card.departureDate)}` : ""}`;
  if (card.season) return card.season;
  return "No date yet";
}

/** The card's edge takes its status's hue: a row of cards reads like the status list. */
const CARD_EDGE: Record<string, string> = {
  blue: "border-s-blue-500",
  slate: "border-s-slate-400",
  amber: "border-s-amber-500",
  violet: "border-s-violet-500",
  indigo: "border-s-indigo-500",
  cyan: "border-s-cyan-500",
  orange: "border-s-orange-500",
  red: "border-s-red-500",
  rose: "border-s-rose-500",
  teal: "border-s-teal-500",
  green: "border-s-green-600",
  gray: "border-s-border",
};

/** One card, folded: what it is, where it stands, what it holds; open = the card page. */
function CardRow({
  card,
  orders,
  data,
  open,
  onOpenChange,
  onChanged,
  flash,
}: {
  card: CaseRow;
  orders: BoardOrder[];
  data: CustomerPageData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
  /** The card the reader came from: highlighted for a moment, never opened by itself (Dor 21.10). */
  flash?: boolean;
}) {
  const today = todayIso();
  const { statuses } = data;
  const reason = todayReason(card, statuses, today);
  const live = orders.filter((o) => o.phase !== "cancelled");
  const travelers = live.reduce((sum, o) => sum + o.travelers, 0);
  // the card's worth = every live order's total (one currency per company; a mixed card shows none rather than a wrong sum)
  const pricedOrders = live.filter((o) => o.total !== null && o.currency);
  const currencies = new Set(pricedOrders.map((o) => o.currency));
  const priced =
    pricedOrders.length > 0 && currencies.size === 1
      ? { total: pricedOrders.reduce((sum, o) => sum + (o.total ?? 0), 0), currency: pricedOrders[0].currency }
      : null;
  const color = statusOf(card.status, statuses)?.color ?? "gray";
  const closed = isClosedStatus(card.status, statuses);
  const [focus, setFocus] = useState<CardFocus | null>(null);
  const offer = offerLine(card);
  const firstNote = card.notes?.trim().split("\n")[0] ?? "";
  const notesLine = firstNote ? (firstNote.length > 48 ? `${firstNote.slice(0, 47)}…` : firstNote) : "Add a note";
  const run = useActionToast();
  const saveFollowUp = async (followUpDate: string | null) => {
    const result = await run(() => updateCase(card.id, { followUpDate }), "Follow-up day saved");
    if (result.success) onChanged();
  };
  // a shortcut opens the card at that part of it
  const go = (section: CardFocus["section"]) => {
    setFocus({ section, at: Date.now() });
    onOpenChange(true);
  };
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} asChild>
      <article
        id={`card-${card.id}`}
        className={cn(
          "group overflow-hidden rounded-lg border border-s-4 bg-card transition-shadow",
          CARD_EDGE[color] ?? "border-s-border",
          closed && "opacity-90",
          flash && "ring-2 ring-primary/60 ring-offset-2 ring-offset-background",
        )}
      >
        <CollapsibleTrigger className="flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 text-start hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90 rtl:-scale-x-100" />
          <StatusTag status={card.status} statuses={statuses} />
          <span dir="auto" className="font-display font-semibold">
            {card.tourName ?? "Tour not chosen"}
          </span>
          <span className="tabular text-sm text-muted-foreground" dir="auto">
            {cardWhen(card)}
          </span>
          {orders.map((o) => (
            <span
              key={o.ref}
              className={cn("rounded border px-1.5 font-mono text-xs", o.phase === "cancelled" ? "text-muted-foreground line-through" : "bg-muted/50")}
              title={o.source === "staff" ? "Typed by a rep" : "From the site"}
            >
              {o.ref}
            </span>
          ))}
          {travelers > 0 && <span className="text-xs text-muted-foreground">{travelers} travelers</span>}
          <span className="flex-1" />
          <StageBar status={card.status} hasOrder={orders.length > 0} statuses={statuses} />
          {reason && <TodayBadge reason={reason} followUpDate={card.followUpDate} today={today} />}
          {card.followUpDate && !closed && reason !== "late" && reason !== "today" && (
            <span className="tabular text-xs text-muted-foreground">Follow-up {fmtDate(card.followUpDate)}</span>
          )}
          {priced && <span className="tabular text-sm font-medium">{fmtPrice(priced.total, priced.currency)}</span>}
        </CollapsibleTrigger>
        {/* shortcuts on the card's outside (Alon 20.10): where the offer stands and what the team wrote, one click into it */}
        <div className="flex flex-wrap gap-2 px-4 pb-3 ps-11">
          <CardShortcut icon={Link2} label="Booking link" value={offer.text} tone={offer.tone} onClick={() => go("link")} />
          <CardShortcut icon={StickyNote} label="Notes" value={notesLine} tone={card.notes?.trim() ? "default" : "muted"} onClick={() => go("notes")} />
          {/* the third shortcut (Dor 20.10): the next follow-up, changed right here */}
          {!closed && (
            <label
              className={cn(
                "inline-flex items-center gap-2 rounded-md border bg-background px-2.5 py-0.5 text-sm",
                followUpDue(card, statuses, today) && "border-red-500/40 bg-red-500/5",
              )}
            >
              <CalendarClock className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="font-medium">Follow-up</span>
              <FollowUpInput ghost value={card.followUpDate} due={followUpDue(card, statuses, today)} className="h-7 w-[8.5rem] text-xs" onSave={(followUpDate) => void saveFollowUp(followUpDate)} />
            </label>
          )}
        </div>
        <CollapsibleContent className="border-t bg-muted/20 p-4">{open && <CasePage id={card.id} embedded focus={focus} onChanged={onChanged} />}</CollapsibleContent>
      </article>
    </Collapsible>
  );
}

type ShortcutTone = "default" | "muted" | "warning";
const SHORTCUT_TONE: Record<ShortcutTone, string> = {
  default: "text-foreground",
  muted: "text-muted-foreground",
  warning: "text-amber-800 dark:text-amber-300",
};

/** A button on a closed card: a label and what stands behind it. */
function CardShortcut({ icon: Icon, label, value, tone, onClick }: { icon: LucideIcon; label: string; value: string; tone: ShortcutTone; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex max-w-full items-center gap-2 rounded-md border bg-background px-2.5 py-1 text-start text-sm hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="font-medium">{label}</span>
      <span dir="auto" className={cn("min-w-0 truncate text-xs", SHORTCUT_TONE[tone])}>
        {value}
      </span>
    </button>
  );
}

/** Where a card's booking link stands, in a few words. */
function offerLine(card: CaseRow): { text: string; tone: ShortcutTone } {
  const offer = card.offer;
  if (!offer) return { text: "None yet", tone: "muted" };
  if (offer.bookingRef) return { text: `Booked · ${offer.bookingRef}`, tone: "default" };
  const price = offer.total !== null && offer.currency ? ` · ${fmtPrice(offer.total, offer.currency)}` : "";
  if (offer.sentAt) return { text: `Sent ${fmtDate(offer.sentAt.slice(0, 10))}${price}`, tone: "default" };
  return { text: `Prepared, not sent${price}`, tone: "warning" };
}

/**
 * /tours/customers/[id] and /tours/reservations/[cardId]. `cardId` opens that card. Before the customers migration
 * (the push to master runs it) a card still opens as the old case page.
 */
export function CustomerPage({ customerId, cardId }: { customerId?: string; cardId?: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const run = useActionToast();
  const { toast } = useToast();
  const wanted = cardId ?? params.get("card") ?? undefined;
  const { data, error, loading, reload, setData } = useActionData<CustomerPageData>(() => getCustomerPage({ customerId, cardId }), [customerId, cardId]);
  const [opened, setOpened] = useState<Set<string> | null>(null);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [merging, setMerging] = useState<"pick" | "suggested" | null>(null);
  const [filing, setFiling] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const today = todayIso();
  // every card opens folded (Dor 21.10: "the user opens what they want"); the card a board row led to is shown, not opened
  const loadedId = data?.customer.id ?? null;
  useEffect(() => {
    if (!loadedId || !wanted) return;
    const element = document.getElementById(`card-${wanted}`);
    if (!element) return;
    element.scrollIntoView({ block: "center", behavior: "smooth" });
    setFlashId(wanted);
    const timer = window.setTimeout(() => setFlashId(null), 1600);
    return () => window.clearTimeout(timer);
  }, [loadedId, wanted]);

  if (!data) {
    // the old case page until the migration ran: the card still opens
    if (error && cardId && /after the system update/.test(error)) return <CasePage id={cardId} />;
    return (
      <div className="space-y-4">
        <BackLink />
        {error && !loading && <LoadError message={error} onRetry={() => void reload()} />}
        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading the customer…
          </div>
        )}
      </div>
    );
  }

  const { customer, cards, orders, statuses } = data;
  const name = customerName(customer) || customer.phones[0] || customer.email || "Customer";
  const open = opened ?? new Set<string>();
  const setOpen = (id: string, value: boolean) => {
    const next = new Set(open);
    if (value) next.add(id);
    else next.delete(id);
    setOpened(next);
  };
  const ordersOf = (id: string) => orders.filter((o) => o.cardId === id);
  const toFile = cards.filter((c) => c.toFile);
  const isHistory = (c: CaseRow) =>
    isClosedStatus(c.status, statuses) || (isPaidStatus(c.status) && !!c.departureDate && c.departureDate < today);
  const openCards = cards.filter((c) => !c.toFile && !isHistory(c));
  const history = cards.filter((c) => !c.toFile && isHistory(c));
  const liveOrders = orders.filter((o) => o.phase === "active").length;
  // over EVERY card of the customer, the hidden ones too (the server says)
  const travelled = data.travelled;

  const saveCustomer = async (change: CustomerChange) => {
    setSaving(true);
    const result = await run(() => updateCustomer(customer.id, change));
    setSaving(false);
    if (result.success) setData((current) => current && { ...current, customer: result.data });
  };

  const file = async (inquiryId: string, target: string | null) => {
    setFiling(inquiryId);
    const result = await run(() => fileInquiry(inquiryId, target), target ? "Filed on the card - the customer came back" : "Opened as its own card");
    setFiling(null);
    if (result.success) {
      setOpened(new Set([result.data.cardId]));
      void reload({ quiet: true });
    }
  };

  return (
    <div className="space-y-6">
      <BackLink />

      {/* the person: one header for every deal of theirs (Nir 19.10 - "the customer's details, then under it...") */}
      <section className="space-y-4 rounded-lg border border-primary/25 bg-[linear-gradient(hsl(var(--primary)/0.06),hsl(var(--primary)/0.01))] p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary" aria-hidden>
            <UserRound className="h-5 w-5" />
          </span>
          <h1 className="text-2xl font-semibold tracking-tight" dir="auto">
            {name}
          </h1>
          <span className="rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 font-mono text-sm font-semibold text-primary">{customerLabel(customer.customerNo)}</span>
          {travelled && <Chip tone="success">Travelled with us</Chip>}
          {saving && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          <div className="ms-auto flex flex-wrap items-center gap-2">
            <WhatsAppButton phone={customer.phones[0] ?? null} message={`היי ${customer.firstName ?? ""}`.trim()} />
            {customer.phones[0] && (
              <Button variant="outline" size="sm" asChild>
                <a href={`tel:${customer.phones[0]}`}>
                  <Phone className="h-4 w-4" />
                  Call
                </a>
              </Button>
            )}
            <MailButton email={customer.email} />
            <Button size="sm" onClick={() => setAdding(true)}>
              <PlusCircle className="h-4 w-4" />
              New card
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setMerging("pick")} title="This person is another customer too - make them one">
              <GitMerge className="h-4 w-4" />
              Merge with…
            </Button>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <HeaderField label="First name" value={customer.firstName} onSave={(firstName) => void saveCustomer({ firstName })} />
          <HeaderField label="Last name" value={customer.lastName} onSave={(lastName) => void saveCustomer({ lastName })} />
          <div className="sm:col-span-2 lg:col-span-2">
            <PhonesField phones={customer.phones} disabled={saving} onSave={(phones) => void saveCustomer({ phones })} />
          </div>
          <HeaderField label="Email" value={customer.email} dir="ltr" inputMode="email" onSave={(email) => void saveCustomer({ email })} />
          <div className="grid grid-cols-2 gap-3">
            <HeaderField label="National id (ת״ז)" value={customer.idNumber} dir="ltr" inputMode="numeric" onSave={(idNumber) => void saveCustomer({ idNumber })} />
            <HeaderField label="ACC NUM" value={customer.accNum} dir="ltr" onSave={(accNum) => void saveCustomer({ accNum })} />
          </div>
        </div>
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span>Customer since {fmtDate(customer.createdAt.slice(0, 10))}</span>
          <span>
            {openCards.length} open {openCards.length === 1 ? "card" : "cards"}
          </span>
          <span>
            {liveOrders} live {liveOrders === 1 ? "order" : "orders"}
          </span>
        </p>
        {data.suggestion && (
          <Notice tone="info" className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <GitMerge className="h-4 w-4 shrink-0" />
            <p className="min-w-0 flex-1">
              Maybe the same customer: <span className="font-mono font-semibold">{customerLabel(data.suggestion.customerNo)}</span>{" "}
              <span dir="auto">{data.suggestion.name}</span> - same e-mail, another phone (
              <span dir="ltr" className="tabular">
                {data.suggestion.phones.join(", ") || EMPTY}
              </span>
              ). Nothing was joined by itself.
            </p>
            <Button size="sm" onClick={() => setMerging("suggested")}>
              Merge
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                const other = data.suggestion;
                if (!other) return;
                const result = await run(() => dismissCustomerSuggestion(customer.id, other.id), "Kept apart - not suggested again");
                if (result.success) setData((current) => current && { ...current, suggestion: null });
              }}
            >
              Not the same
            </Button>
          </Notice>
        )}
      </section>

      {/* inquiries that name no tour while the customer has open cards: the rep says where they go */}
      {toFile.map((inquiry) => (
        <section key={inquiry.id} className="space-y-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Inbox className="h-4 w-4 text-amber-700 dark:text-amber-300" />
            <h2 className="font-display text-sm font-semibold">New inquiry to file</h2>
            <span className="tabular text-xs text-muted-foreground">{fmtInstant(inquiry.createdAt)}</span>
            <span className="text-xs text-muted-foreground">{LEAD_KIND_LABELS[inquiry.kind] ?? inquiry.kind}</span>
            <span className="text-xs text-muted-foreground">
              Sent as{" "}
              {[customerName(inquiry), inquiry.phone, inquiry.email].filter(Boolean).map((part, j) => (
                <span key={j} dir="auto">
                  {j > 0 && " · "}
                  {part}
                </span>
              ))}
            </span>
          </div>
          {/* it reached this customer by the phone alone, which anyone can type (security review 19.10) */}
          {senderDiffers(
            { name: customerName(inquiry), phone: inquiry.phone, email: inquiry.email },
            { name: customerName(customer), email: customer.email },
          ) && (
            <p className="flex items-start gap-1.5 text-xs font-medium text-amber-800 dark:text-amber-300">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Sent with this customer&apos;s phone but another name or e-mail - check it is them before you file it.
            </p>
          )}
          {inquiry.message ? (
            <p dir="auto" className="whitespace-pre-wrap break-words rounded-md border bg-background px-3 py-2 text-sm">
              {inquiry.message}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">The form came without a message.</p>
          )}
          <p className="text-xs text-muted-foreground">It names no tour and the customer has open cards - choose where it goes.</p>
          <div className="flex flex-wrap gap-2">
            {openCards.map((c) => (
              <Button key={c.id} size="sm" variant="outline" disabled={filing === inquiry.id} onClick={() => void file(inquiry.id, c.id)}>
                Add to: <span dir="auto">{c.tourName ?? `#${c.caseNo}`}</span> · <span dir="rtl">{statusOf(c.status, statuses)?.label ?? c.status}</span>
              </Button>
            ))}
            <Button size="sm" disabled={filing === inquiry.id} onClick={() => void file(inquiry.id, null)}>
              {filing === inquiry.id && <Loader2 className="h-4 w-4 animate-spin" />}
              Open a new card
            </Button>
          </div>
        </section>
      ))}

      <section className="space-y-3" aria-label="Cards">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="font-display text-base font-semibold">Cards</h2>
          <span className="text-sm text-muted-foreground">One card per deal - it starts as a lead and becomes the order.</span>
        </div>
        {openCards.length === 0 ? (
          <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">No open card. Add one with New card.</p>
        ) : (
          openCards.map((c) => (
            <CardRow key={c.id} card={c} orders={ordersOf(c.id)} data={data} open={open.has(c.id)} flash={flashId === c.id} onOpenChange={(v) => setOpen(c.id, v)} onChanged={() => void reload({ quiet: true })} />
          ))
        )}
        {data.hiddenCards > 0 && (
          <p className="text-xs text-muted-foreground">
            {data.hiddenCards === 1 ? "1 card of another rep is not shown" : `${data.hiddenCards} cards of other reps are not shown`}
          </p>
        )}
      </section>

      {history.length > 0 && (
        <section className="space-y-3" aria-label="History">
          <div className="flex flex-wrap items-baseline gap-2">
            <h2 className="font-display text-base font-semibold">History</h2>
            <span className="text-sm text-muted-foreground">Closed deals and trips that left.</span>
          </div>
          {history.map((c) => (
            <CardRow key={c.id} card={c} orders={ordersOf(c.id)} data={data} open={open.has(c.id)} flash={flashId === c.id} onOpenChange={(v) => setOpen(c.id, v)} onChanged={() => void reload({ quiet: true })} />
          ))}
        </section>
      )}

      <NewCaseDialog
        open={adding}
        onOpenChange={setAdding}
        reps={data.reps}
        currentUserId={data.currentUserId}
        customer={customer}
        onCreated={(id, handedTo) => {
          // a rep who opened the card for someone else will not see it: say so (review 21.10)
          if (handedTo && !data.viewer.manager) toast({ title: `Card opened and handed to ${data.reps.find((p) => p.id === handedTo)?.name ?? "another rep"}` });
          else setOpened(new Set([id]));
          void reload({ quiet: true });
        }}
      />
      {merging && (
        <MergeCustomerDialog
          customer={customer}
          preset={
            merging === "suggested" && data.suggestion
              ? { id: data.suggestion.id, customerNo: data.suggestion.customerNo, name: data.suggestion.name, phones: data.suggestion.phones, email: data.suggestion.email, cards: 0 }
              : null
          }
          onCancel={() => setMerging(null)}
          onMerged={() => {
            setMerging(null);
            void reload({ quiet: true });
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/tours/reservations" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
      Reservations
    </Link>
  );
}
