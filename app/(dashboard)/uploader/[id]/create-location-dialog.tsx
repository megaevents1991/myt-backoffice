"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Loader2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
// `@/hooks/use-toast`, not `@/components/ui/use-toast`: the mounted <Toaster /> reads this store.
import { useToast } from "@/hooks/use-toast";
import { createLocationAndAnswer, proposeLocation } from "@/lib/actions/uploader-actions";
import { LOCATION_NAME_MAX, validateLocationInput, type LocationInput } from "@/lib/uploader/location";
import type { UploaderItem } from "@/types/uploader.types";
import { actionErrorText } from "../copy";
import { AiWait } from "./ai-wait";
import {
  aiLine,
  BTN_CANCEL,
  BTN_CREATE_LOCATION,
  LOCATION_ALIASES_HINT,
  LOCATION_ALIASES_LABEL,
  LOCATION_COORDS_HINT,
  LOCATION_COUNTRY_LABEL,
  LOCATION_DONE,
  LOCATION_IATA_LABEL,
  LOCATION_INTRO,
  LOCATION_LAT_LABEL,
  LOCATION_LON_LABEL,
  LOCATION_NAME_LABEL,
  LOCATION_NAME_PLACEHOLDER,
  LOCATION_NO_COORDS_HINT,
  LOCATION_OPEN_FAILED,
  LOCATION_TASK_OPEN,
  LOCATION_TITLE,
  LOCATION_WAIT,
  NETWORK_TEXT,
} from "./board-words";
import { rtl } from "./use-run-board";

// "צור מיקום חדש" (Alon's round 2, spec 4.2): opened by the `create` option of a `create_location` /
// `pick_location` question. One AI call (`proposeLocation` - off / capped / failed = the same form with what
// the show itself knows: its coordinates, country and the city as the supplier spells it) fills the Hebrew name,
// the IATA, the city centre and the other spellings; a person reads, corrects and confirms
// (`createLocationAndAnswer`: the `locations` row, then the question - and the run's other questions of the same
// city - answered with it). The form is checked here with the server's own rule (`validateLocationInput`) so a
// slip shows at once; the server checks it again, with the table's rows (the duplicate).

type Phase = { kind: "loading" } | { kind: "ready" };
type Form = { name: string; iata: string; lat: string; lon: string; country: string; aliases: string };
type Ai = "ok" | "off" | "no_answer" | "rate_limited";

const EMPTY_FORM: Form = { name: "", iata: "", lat: "", lon: "", country: "", aliases: "" };

/** The proposal as the boxes show it: (0, 0) is "the show has no coordinates" - the box stays empty for the person to type. */
function formOf(p: LocationInput): Form {
  const noCoords = p.latitude === 0 && p.longitude === 0;
  return {
    name: p.name_he,
    iata: p.iata,
    lat: noCoords ? "" : String(p.latitude),
    lon: noCoords ? "" : String(p.longitude),
    country: p.country_code ?? "",
    aliases: p.aliases.join(", "),
  };
}

/** A coordinate box as a number; null = empty. Text that is no number comes out NaN (the rule refuses it). */
function coordOf(text: string): number | null {
  const t = text.trim().replace(",", ".");
  return t === "" ? null : Number(t);
}

/** The boxes as `createLocationAndAnswer` takes them. `proposed` = the AI's proposal as shown (audit and lessons only). */
function inputOf(form: Form, proposed: LocationInput | null) {
  return {
    name_he: form.name,
    iata: form.iata,
    latitude: coordOf(form.lat),
    longitude: coordOf(form.lon),
    country_code: form.country.trim() === "" ? null : form.country,
    aliases: form.aliases.split(/[,;\n]/),
    proposed,
  };
}

export function CreateLocationDialog({
  item,
  onClose,
  onDone,
}: {
  /** The question the dialog was opened from; null = closed. Only its id is watched - a board refresh never re-asks the AI. */
  item: UploaderItem | null;
  onClose: () => void;
  /** After a saved location (its toast already shown): the board closes the dialog, reads the run again and wakes the build. */
  onDone: () => void | Promise<void>;
}) {
  const { toast } = useToast();
  const itemId = item?.id ?? null;
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [ai, setAi] = useState<Ai>("no_answer");
  /** What the AI proposed, as the boxes were first filled - sent back with the confirm for the audit row. */
  const [proposal, setProposal] = useState<LocationInput | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** The show the dialog is for, kept while it closes so the text never blanks mid-animation. */
  const [shown, setShown] = useState<UploaderItem | null>(null);
  const seq = useRef(0);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  // A (re)opening starts on the wait in the same render - never a frame of the previous form.
  const [openId, setOpenId] = useState<string | null>(null);
  if (itemId !== openId) {
    setOpenId(itemId);
    if (itemId !== null) {
      setShown(item);
      setPhase({ kind: "loading" });
      setForm(EMPTY_FORM);
      setProposal(null);
      setProblem(null);
    }
  }

  useEffect(() => {
    if (itemId === null) return;
    const id = ++seq.current;
    const fail = (description: ReactNode) => {
      toast({ variant: "destructive", title: LOCATION_OPEN_FAILED, description: rtl(description) });
      closeRef.current();
    };
    proposeLocation(itemId)
      .then((r) => {
        if (id !== seq.current) return;
        if (!r.ok) return fail(actionErrorText(r.kind));
        setForm(formOf(r.proposal));
        setAi(r.ai);
        setProposal(r.ai === "ok" ? r.proposal : null);
        setPhase({ kind: "ready" });
      })
      .catch(() => {
        if (id === seq.current) fail(NETWORK_TEXT);
      });
    return () => {
      seq.current += 1;
    };
  }, [itemId, toast]);

  const setField = (patch: Partial<Form>) => {
    setForm((f) => ({ ...f, ...patch }));
    setProblem(null);
  };
  const ready = phase.kind === "ready";
  const line = ready ? aiLine({ used: ai === "ok", reason: ai === "rate_limited" ? "rate_limited" : ai === "ok" ? null : "off" }) : null;
  const show = shown?.show ?? null;

  async function confirm() {
    if (!ready || saving || !shown) return;
    const input = inputOf(form, proposal);
    const checked = validateLocationInput(input, []);
    if (!checked.ok) {
      setProblem(checked.problem);
      return;
    }
    setSaving(true);
    setProblem(null);
    try {
      const r = await createLocationAndAnswer(shown.id, input);
      if (!r.ok) {
        // The form stays open with the reason under it (a duplicate names the existing row).
        setProblem(r.problem ?? actionErrorText(r.kind));
        return;
      }
      toast({
        title: LOCATION_DONE(checked.value.name_he, r.applied + 1),
        ...(r.task_closed ? {} : { description: rtl(LOCATION_TASK_OPEN) }),
      });
      await onDone();
    } catch {
      setProblem(NETWORK_TEXT);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={itemId !== null}
      onOpenChange={(next) => {
        if (!next && !saving) onClose();
      }}
    >
      <DialogContent dir="rtl" className="max-w-lg [&>button:last-child]:left-4 [&>button:last-child]:right-auto">
        <DialogHeader className="text-start sm:text-start">
          <DialogTitle className="pe-6">{LOCATION_TITLE(show?.city ?? "")}</DialogTitle>
          <DialogDescription>{LOCATION_INTRO}</DialogDescription>
        </DialogHeader>

        {!ready ? (
          <AiWait label={LOCATION_WAIT} />
        ) : (
          <form
            id="uploader-location"
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void confirm();
            }}
          >
            {line && (
              <p className="flex items-center gap-1.5 rounded-md bg-warning-muted px-3 py-2 text-[13px] text-warning">
                <Wand2 aria-hidden className="h-3.5 w-3.5 shrink-0" />
                {line}
              </p>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="uploader-location-name">{LOCATION_NAME_LABEL}</Label>
              <Input
                id="uploader-location-name"
                dir="rtl"
                value={form.name}
                maxLength={LOCATION_NAME_MAX}
                placeholder={LOCATION_NAME_PLACEHOLDER}
                disabled={saving}
                onChange={(e) => setField({ name: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="uploader-location-iata">{LOCATION_IATA_LABEL}</Label>
                <Input
                  id="uploader-location-iata"
                  dir="ltr"
                  value={form.iata}
                  maxLength={3}
                  placeholder="VLC"
                  autoCapitalize="characters"
                  disabled={saving}
                  onChange={(e) => setField({ iata: e.target.value.toUpperCase() })}
                  className="uppercase"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="uploader-location-country">{LOCATION_COUNTRY_LABEL}</Label>
                <Input
                  id="uploader-location-country"
                  dir="ltr"
                  value={form.country}
                  maxLength={2}
                  placeholder="ES"
                  autoCapitalize="characters"
                  disabled={saving}
                  onChange={(e) => setField({ country: e.target.value.toUpperCase() })}
                  className="uppercase"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="uploader-location-lat">{LOCATION_LAT_LABEL}</Label>
                  <Input
                    id="uploader-location-lat"
                    dir="ltr"
                    inputMode="decimal"
                    value={form.lat}
                    placeholder="39.4699"
                    disabled={saving}
                    onChange={(e) => setField({ lat: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="uploader-location-lon">{LOCATION_LON_LABEL}</Label>
                  <Input
                    id="uploader-location-lon"
                    dir="ltr"
                    inputMode="decimal"
                    value={form.lon}
                    placeholder="-0.3763"
                    disabled={saving}
                    onChange={(e) => setField({ lon: e.target.value })}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">{show && show.lat === null ? LOCATION_NO_COORDS_HINT : LOCATION_COORDS_HINT}</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="uploader-location-aliases">{LOCATION_ALIASES_LABEL}</Label>
              <Input
                id="uploader-location-aliases"
                dir="ltr"
                value={form.aliases}
                placeholder="Valencia, València"
                disabled={saving}
                onChange={(e) => setField({ aliases: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">{LOCATION_ALIASES_HINT}</p>
            </div>

            {problem && (
              <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
                {problem}
              </p>
            )}
          </form>
        )}

        <DialogFooter className="gap-2 sm:space-x-0">
          <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
            {BTN_CANCEL}
          </Button>
          {ready && (
            <Button type="submit" form="uploader-location" disabled={saving}>
              {saving && <Loader2 aria-hidden className="animate-spin" />}
              {BTN_CREATE_LOCATION}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
