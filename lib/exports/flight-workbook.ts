import ExcelJS from "exceljs";
import type { OfflineFlight } from "@/types/offline-flight.types";

export type ManifestRow = {
  airline_code: string;
  flight_id: number;
  outbound_flight_number: string;
  outbound_departure_time: string;
  inbound_flight_number: string;
  inbound_departure_time: string;
  route: string;
  pnr: string | null;
  reservation_id: number;
  reservation_status: string;
  first_name: string;
  last_name: string;
  passport_number: string | null;
  passport_expiry: string | null;
  date_of_birth: string | null;
  gender: string | null;
  nationality: string | null;
  contact_email: string;
  contact_phone: string;
};

type SheetColumn = { header: string; key: string; width: number };

// Excel forbids : \ / ? * [ ] in sheet names and caps them at 31 chars.
function safeSheetName(name: string): string {
  const cleaned = (name || "UNKNOWN").replace(/[:\\/?*[\]]/g, "-");
  return cleaned.slice(0, 31);
}

function addSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  columns: SheetColumn[],
  rows: Record<string, unknown>[],
): void {
  const sheet = workbook.addWorksheet(safeSheetName(name));
  sheet.columns = columns;
  sheet.addRows(rows);
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const bucket = key(row) || "UNKNOWN";
    const existing = out.get(bucket);
    if (existing) existing.push(row);
    else out.set(bucket, [row]);
  }
  return out;
}

const INVENTORY_COLUMNS: SheetColumn[] = [
  { header: "ID", key: "id", width: 8 },
  { header: "Flight no.", key: "outbound_flight_number", width: 12 },
  { header: "From", key: "outbound_departure_airport", width: 8 },
  { header: "To", key: "outbound_arrival_airport", width: 8 },
  { header: "Departure", key: "outbound_departure_time", width: 20 },
  { header: "Return", key: "inbound_departure_time", width: 20 },
  { header: "ORG", key: "initial_quantity", width: 8 },
  { header: "TAKEN", key: "consumed_quantity", width: 8 },
  { header: "AVAILABLE", key: "available", width: 11 },
  { header: "Sell price", key: "price", width: 12 },
  { header: "Cost price", key: "cost_price", width: 12 },
  { header: "Currency", key: "cost_currency", width: 10 },
  { header: "Supplier", key: "supplier", width: 18 },
  { header: "PNR", key: "pnr", width: 12 },
  { header: "Contract", key: "group_code", width: 14 },
  { header: "Ticketing deadline", key: "ticketing_deadline", width: 18 },
  { header: "Cancellation deadline", key: "last_cancellation_date", width: 20 },
  { header: "Status", key: "block_status", width: 12 },
  { header: "Series", key: "series_name", width: 18 },
  { header: "Notes", key: "notes", width: 30 },
];

const MANIFEST_COLUMNS: SheetColumn[] = [
  { header: "Last name", key: "last_name", width: 18 },
  { header: "First name", key: "first_name", width: 18 },
  { header: "Passport", key: "passport_number", width: 16 },
  { header: "Passport expiry", key: "passport_expiry", width: 16 },
  { header: "Date of birth", key: "date_of_birth", width: 14 },
  { header: "Gender", key: "gender", width: 8 },
  { header: "Nationality", key: "nationality", width: 12 },
  { header: "Flight no.", key: "outbound_flight_number", width: 12 },
  { header: "Departure", key: "outbound_departure_time", width: 20 },
  { header: "Return flight", key: "inbound_flight_number", width: 13 },
  { header: "Return", key: "inbound_departure_time", width: 20 },
  { header: "Route", key: "route", width: 12 },
  { header: "PNR", key: "pnr", width: 12 },
  { header: "Reservation", key: "reservation_id", width: 12 },
  { header: "Status", key: "reservation_status", width: 12 },
  { header: "Contact email", key: "contact_email", width: 26 },
  { header: "Contact phone", key: "contact_phone", width: 16 },
];

export async function buildInventoryWorkbook(
  flights: OfflineFlight[],
): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  const byAirline = groupBy(flights, (f) => f.airline_code);

  for (const [airline, group] of byAirline) {
    addSheet(
      workbook,
      airline,
      INVENTORY_COLUMNS,
      group.map((f) => ({
        ...f,
        available: f.initial_quantity - f.consumed_quantity,
      })),
    );
  }
  if (byAirline.size === 0) addSheet(workbook, "EMPTY", INVENTORY_COLUMNS, []);
  return (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
}

export async function buildManifestWorkbook(
  rows: ManifestRow[],
): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  const byAirline = groupBy(rows, (r) => r.airline_code);

  for (const [airline, group] of byAirline) {
    addSheet(
      workbook,
      airline,
      MANIFEST_COLUMNS,
      group as unknown as Record<string, unknown>[],
    );
  }
  if (byAirline.size === 0) addSheet(workbook, "EMPTY", MANIFEST_COLUMNS, []);
  return (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
}
