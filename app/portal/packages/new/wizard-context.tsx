"use client";

/**
 * Shared wizard state — the portal's equivalent of myt-main's OrderContext
 * (app/order/layout.tsx there): one provider that never unmounts across steps,
 * so edit-from-summary keeps every selection.
 */

import { createContext, useContext } from "react";
import type {
  BuilderCommissionTerms,
  BuilderEvent,
  BuilderFlight,
  BuilderHotelRoom,
  LiveFlightOffer,
  LiveHotelOption,
  LiveTicketCategory,
} from "@/lib/actions/portal-package-actions";
import type { TixStockMatchableListing } from "@/lib/tixstock-map";
import type { Delta } from "./wizard-ui";

export type FlightChoice =
  | { mode: "offline"; flightId: number }
  | { mode: "live-offer"; offer: LiveFlightOffer }
  /** "live" is BOTH the silent default and an explicit agent decision —
   *  `explicit` tells them apart so the bar tab fills only once chosen. */
  | { mode: "live"; explicit?: boolean }
  | { mode: "none" };

export type HotelChoice =
  | { mode: "offline"; units: Record<number, number> }
  | { mode: "live-offer"; option: LiveHotelOption }
  | { mode: "live"; explicit?: boolean }
  | { mode: "none" };

export type TicketOption = {
  category: string;
  price: number;
  id: string;
  vendor?: string;
  site_price: number | null;
};

export interface WizardState {
  /* navigation */
  step: number;
  setStep: (step: number) => void;
  goNext: () => void;
  goBack: () => void;
  /** Edit-from-summary flag — main's returnToSummary. */
  returnToSummary: boolean;

  /* event */
  events: BuilderEvent[];
  event: BuilderEvent | null;
  selectEvent: (event: BuilderEvent) => void;

  /* tickets */
  qty: number;
  setQty: (qty: number) => void;
  category: string | null;
  setCategory: (category: string | null) => void;
  activeTickets: TicketOption[];
  selectedTicket: TicketOption | null;
  isTx: boolean;
  liveTix: LiveTicketCategory[] | null;
  tixListings: TixStockMatchableListing[];
  tixLoading: boolean;
  tixError: string | null;
  hoveredCat: string | null;
  setHoveredCat: (category: string | null) => void;

  /* inventory */
  flights: BuilderFlight[];
  hotels: BuilderHotelRoom[];
  inventoryLoading: boolean;

  /* flight step */
  flightChoice: FlightChoice;
  setFlightChoice: (choice: FlightChoice) => void;
  fsDepart: string;
  setFsDepart: (value: string) => void;
  fsReturn: string;
  setFsReturn: (value: string) => void;
  fsLoading: boolean;
  fsError: string | null;
  fsResults: LiveFlightOffer[] | null;
  runFlightSearch: () => void;

  /* hotel step */
  hotelChoice: HotelChoice;
  setHotelChoice: (choice: HotelChoice | ((prev: HotelChoice) => HotelChoice)) => void;
  selectedUnits: Record<number, number>;
  setUnitCount: (room: BuilderHotelRoom, delta: number) => void;
  hotelCapacity: number;
  hotelTotal: number;
  hsCheckin: string;
  setHsCheckin: (value: string) => void;
  hsCheckout: string;
  setHsCheckout: (value: string) => void;
  hsLoading: boolean;
  hsError: string | null;
  hsResults: LiveHotelOption[] | null;
  runHotelSearch: () => void;
  defaultHotelDates: () => { checkin: string; checkout: string };

  /* pricing (per person, vs the site's package baselines) */
  basePerPerson: number | null;
  ticketDelta: Delta | null;
  flightDelta: Delta | null;
  hotelDelta: Delta | null;
  totalPerPerson: number | null;
  commissionTerms: BuilderCommissionTerms | null;

  /* finish */
  allowEdit: boolean;
  setAllowEdit: (value: boolean) => void;
  submit: () => void;
  isPending: boolean;
  submitError: string | null;
}

export const WizardContext = createContext<WizardState | null>(null);

export function useWizard(): WizardState {
  const ctx = useContext(WizardContext);
  if (!ctx) throw new Error("useWizard outside WizardContext");
  return ctx;
}
