"use client";

import { useFormContext, type FieldValues } from "react-hook-form";

import { Input } from "@/components/ui/input";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** The form-only field that drives the reveal; stripped before saving. */
export type StopToggleField = "outbound_has_stop" | "inbound_has_stop";

/**
 * Stops for ONE leg. Outbound and inbound each get their own copy, because a
 * package can fly out direct and come back through a connection - or connect
 * through a different airport in each direction.
 *
 * Picking "1 stop" is what reveals the airport and layover inputs, and the
 * schema then requires the airport: a stop count with no airport behind it is
 * exactly the half-filled state that used to reach the customer as "direct".
 * Choosing "Direct" clears both fields rather than leaving orphans in the row.
 */
export function FlightStopoverFields({
  direction,
}: {
  direction: "outbound" | "inbound";
}) {
  const form = useFormContext<FieldValues>();
  const toggleName: StopToggleField = `${direction}_has_stop`;
  const airportName = `${direction}_stop_airport`;
  const durationName = `${direction}_stop_duration`;
  const label = direction === "outbound" ? "Outbound" : "Inbound";

  const hasStop = form.watch(toggleName) === "1";

  return (
    <>
      <FormField
        control={form.control}
        name={toggleName}
        render={({ field }) => (
          <FormItem>
            <FormLabel>{label} Stops</FormLabel>
            <Select
              value={field.value === "1" ? "1" : "0"}
              onValueChange={(value) => {
                field.onChange(value);
                if (value === "0") {
                  form.setValue(airportName, "", { shouldDirty: true });
                  form.setValue(durationName, "", { shouldDirty: true });
                }
              }}
            >
              <FormControl>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                <SelectItem value="0">Direct</SelectItem>
                <SelectItem value="1">1 stop (connection)</SelectItem>
              </SelectContent>
            </Select>
            <FormDescription>
              Set per direction - this leg can connect while the other flies
              direct.
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      {hasStop && (
        <>
          <FormField
            control={form.control}
            name={airportName}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{label} Stopover Airport</FormLabel>
                <FormControl>
                  <Input
                    placeholder="e.g., VIE"
                    maxLength={3}
                    {...field}
                    value={field.value ?? ""}
                    onChange={(event) =>
                      field.onChange(event.target.value.toUpperCase())
                    }
                  />
                </FormControl>
                <FormDescription>
                  Where this leg connects. Required - without it the flight saves
                  as direct.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name={durationName}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{label} Layover</FormLabel>
                <FormControl>
                  <Input
                    placeholder="e.g., 2:30"
                    {...field}
                    value={field.value ?? ""}
                  />
                </FormControl>
                <FormDescription>
                  Time on the ground, HH:MM. Optional.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </>
      )}
    </>
  );
}
