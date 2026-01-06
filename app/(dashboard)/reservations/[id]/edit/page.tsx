"use client";

import type React from "react";
import { use, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import type { Reservation } from "@/types/reservation.types";
import type { EventTicket } from "@/types/app.types";
import {
  getReservation,
  updateReservation,
} from "@/lib/actions/reservation-actions";
import { getEvent } from "@/lib/actions/event-actions";
import { normalizeReservationEventOrderInfo } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function EditReservationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const resolvedParams = use(params);
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [ticketVendor, setTicketVendor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [reservationToSave, setReservationToSave] =
    useState<Reservation | null>(null);

  useEffect(() => {
    async function fetchReservation() {
      try {
        const data = await getReservation(Number.parseInt(resolvedParams.id));
        setReservation(data);

        const events = normalizeReservationEventOrderInfo(data.event_order_info);
        const singleEvent = events.length === 1 ? events[0] : null;
        const shouldFetchVendor =
          !!singleEvent && !singleEvent.vendor && !!data.event_id;

        // Legacy fallback: fetch event details to infer vendor from category
        if (shouldFetchVendor) {
          try {
            const eventData = await getEvent(data.event_id);

            // Find the vendor for the ticket category in this reservation
            if (eventData.tickets_and_rates && singleEvent?.category) {
              const matchingTicket = eventData.tickets_and_rates.find(
                (ticket: EventTicket) => ticket.category === singleEvent.category
              );
              setTicketVendor(matchingTicket?.vendor || null);
            } else {
              setTicketVendor(null);
            }
          } catch (eventError) {
            console.error("Error fetching event details:", eventError);
            // Don't show error to user for event details, just log it
            setTicketVendor(null);
          }
        } else {
          setTicketVendor(null);
        }
      } catch (error) {
        console.error("Error fetching reservation:", error);
        toast({
          variant: "destructive",
          title: "Error",
          description: "Failed to load reservation details. Please try again.",
        });
      } finally {
        setLoading(false);
      }
    }

    fetchReservation();
  }, [resolvedParams.id, toast]);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;

    if (name.includes(".")) {
      const [parent, child] = name.split(".");
      setReservation((prev) => {
        if (!prev) return prev;
        const parentValue = prev[parent as keyof Reservation];
        return {
          ...prev,
          [parent]: {
            ...(parentValue && typeof parentValue === "object"
              ? parentValue
              : {}),
            [child]: value,
          },
        };
      });
    } else {
      setReservation((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          [name]: value,
        };
      });
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reservation) return;

    setReservationToSave(reservation);
    setShowConfirmDialog(true);
  };

  const handleConfirmSave = async () => {
    if (!reservationToSave) return;

    setSaving(true);
    setShowConfirmDialog(false);
    try {
      await updateReservation(reservationToSave.id, reservationToSave);
      toast({
        title: "Success",
        description: "Reservation has been updated successfully.",
      });
      router.push(`/reservations/${reservationToSave.id}`);
    } catch (error) {
      console.error("Error updating reservation:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to update reservation. Please try again.",
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div>Loading reservation details...</div>;
  }

  if (!reservation) {
    return <div>Reservation not found</div>;
  }

  const reservationEvents = normalizeReservationEventOrderInfo(
    reservation.event_order_info
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center">
        <Button variant="ghost" onClick={() => router.back()}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <h1 className="text-3xl font-bold tracking-tight ml-4">
          Edit Reservation #{reservation.id}
        </h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        <Card>
          <CardHeader>
            <CardTitle>Customer Information</CardTitle>
            <CardDescription>
              Edit the customer contact details.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="main_contact_first_name">First Name</Label>
                <Input
                  id="main_contact_first_name"
                  name="main_contact_first_name"
                  value={reservation.main_contact_first_name}
                  onChange={handleChange}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="main_contact_last_name">Last Name</Label>
                <Input
                  id="main_contact_last_name"
                  name="main_contact_last_name"
                  value={reservation.main_contact_last_name}
                  onChange={handleChange}
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="status">Status</Label>
                <div className="flex items-center space-x-2">
                  <select
                    id="status"
                    name="status"
                    value={reservation.status}
                    onChange={handleChange}
                    className="border rounded px-2 py-1"
                  >
                    <option value="">Select a status</option>
                    <option value="Paid">Paid</option>
                    <option value="Lost">Lost</option>
                    <option value="Pending">Pending</option>
                    <option value="Follow-up">Follow-up</option>
                  </select>
                  <Input
                    id="custom-status"
                    name="status"
                    placeholder="Enter custom status"
                    value={reservation.status}
                    onChange={handleChange}
                    className="flex-1"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="main_contact_email">Email</Label>
                <Input
                  id="main_contact_email"
                  name="main_contact_email"
                  type="email"
                  value={reservation.main_contact_email}
                  onChange={handleChange}
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="main_contact_phone_number">Phone</Label>
              <Input
                id="main_contact_phone_number"
                name="main_contact_phone_number"
                value={reservation.main_contact_phone_number}
                onChange={handleChange}
                required
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Event & Ticket Details</CardTitle>
            <CardDescription>
              Information about the event and tickets for this reservation.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {reservationEvents.length > 0 && (
              <div className="space-y-6">
                {reservationEvents.map((evt, index) => {
                  const vendor = evt.vendor || (reservationEvents.length === 1 ? ticketVendor : null);
                  return (
                    <div key={`${evt.event_id}-${evt.id ?? index}`}>
                      {reservationEvents.length > 1 && (
                        <p className="text-sm font-medium mb-3">
                          Event {index + 1}
                        </p>
                      )}
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label>Event Name</Label>
                          <p className="text-sm text-muted-foreground">
                            {evt.name}
                          </p>
                        </div>
                        <div>
                          <Label>Event Date</Label>
                          <p className="text-sm text-muted-foreground">
                            {evt.date ? new Date(evt.date).toLocaleDateString() : "—"}
                          </p>
                        </div>
                        <div>
                          <Label>Location</Label>
                          <p className="text-sm text-muted-foreground">
                            {evt.location_name}
                          </p>
                        </div>
                        <div>
                          <Label>Ticket Category</Label>
                          <p className="text-sm text-muted-foreground">
                            {evt.category}
                          </p>
                        </div>
                        <div>
                          <Label>Number of Tickets</Label>
                          <p className="text-sm text-muted-foreground">
                            {evt.number_of_ticket}
                          </p>
                        </div>
                        {vendor && (
                          <div>
                            <Label>Ticket Vendor</Label>
                            <p className="text-sm text-muted-foreground">
                              {vendor}
                            </p>
                          </div>
                        )}
                      </div>
                      {index < reservationEvents.length - 1 && (
                        <Separator className="mt-6" />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Reservation Details</CardTitle>
            <CardDescription>
              Edit the general reservation information.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="user_shown_price">Total Price</Label>
              <Input
                id="user_shown_price"
                name="user_shown_price"
                type="number"
                value={reservation.user_shown_price}
                onChange={(e) => {
                  setReservation((prev) => {
                    if (!prev) return prev;
                    return {
                      ...prev,
                      user_shown_price: Number.parseFloat(e.target.value),
                    };
                  });
                }}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="aff_partner_tracking_code">
                Partner Tracking Code
              </Label>
              <Input
                id="aff_partner_tracking_code"
                name="aff_partner_tracking_code"
                value={reservation.aff_partner_tracking_code}
                onChange={handleChange}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="comments">Accounting Number</Label>
              <Input
                id="accounting_number"
                name="accounting_number"
                value={reservation.accounting_number}
                onChange={handleChange}
                placeholder="Enter document number"
                type="number"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="comments">Comments</Label>
              <Input
                id="comments"
                name="comments"
                value={reservation.comments}
                onChange={handleChange}
                placeholder="Enter any additional comments"
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-4">
          <Button variant="outline" type="button" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </form>

      {showConfirmDialog && (
        <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Are you sure?</DialogTitle>
            </DialogHeader>
            <p>Do you want to save the changes to this reservation?</p>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowConfirmDialog(false)}
              >
                Cancel
              </Button>
              <Button onClick={handleConfirmSave}>Yes, Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
