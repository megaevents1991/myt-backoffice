# P1 Tickets Provider Integration

## Overview

The P1 Tickets provider integration allows the backoffice to sync and manage events from P1 Tickets XML feeds. This integration follows the same architecture pattern as the LiveTickets provider.

## Architecture

### Data Flow

```
P1 XML Feeds → Sync Service → Supabase Database → Backend API → Frontend UI
```

### Components

1. **Type Definitions** (`types/p1-events.types.ts`)

   - `P1Event` - Raw event data from XML
   - `P1Ticket` - Raw ticket data from XML
   - `P1EventDB` - Database model with snake_case fields
   - Constants for currencies, categories, ticket types, tags

2. **Sync Service** (`lib/services/p1-events-sync.ts`)

   - Fetches events and tickets from XML feeds
   - Parses XML using `fast-xml-parser`
   - Normalizes and validates data
   - Filters future events with available tickets
   - Groups tickets by event_id
   - Batch upserts to Supabase

3. **API Endpoints**

   - `POST /api/p1-events/sync` - Trigger data sync
   - `GET /api/p1-events/sync` - Get sync status and statistics
   - `GET /api/p1-events/events` - Query events with filters

4. **Client Actions** (`lib/actions/p1-events-actions.ts`)

   - `getP1Events()` - Fetch all events
   - `getP1EventsByCategory()` - Filter by category
   - `getP1EventsBySeries()` - Filter by series
   - `getP1EventById()` - Get single event
   - `getP1Tickets()` - Get tickets for event
   - `triggerP1Sync()` - Trigger sync
   - `getP1SyncStatus()` - Get sync status

5. **Frontend UI** (`app/(dashboard)/p1-events/`)
   - Hierarchical filtering interface (5 columns):
     1. Categories (FOOTBALL, TENNIS, etc.)
     2. Series (only visible when category selected)
     3. Cities
     4. Events
     5. Tickets
   - Search and pagination on all columns
   - Event creation workflow with currency conversion

## Database Schema

### Table: `p1_events`

```sql
CREATE TABLE p1_events (
  event_id VARCHAR PRIMARY KEY,              -- UUID from P1
  title VARCHAR NOT NULL,
  title_english VARCHAR NOT NULL,
  category VARCHAR NOT NULL,                 -- FOOTBALL, TENNIS, etc.
  series_id VARCHAR,
  series_name VARCHAR,
  has_available_tickets BOOLEAN DEFAULT true,
  is_advertisable BOOLEAN DEFAULT true,
  date_start TIMESTAMP WITH TIME ZONE NOT NULL,
  date_end TIMESTAMP WITH TIME ZONE,
  date_confirmed BOOLEAN DEFAULT false,
  stock INTEGER DEFAULT 0,
  venue_name VARCHAR NOT NULL,
  venue_city VARCHAR NOT NULL,
  venue_country_code VARCHAR(2),
  venue_latitude DECIMAL(10, 8),
  venue_longitude DECIMAL(11, 8),
  compare_price_ticket_only DECIMAL(10, 2),
  compare_price_ticket_hotel DECIMAL(10, 2),
  checkout_link TEXT,
  tickets JSONB,                             -- Array of P1Ticket objects
  last_synced TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### Indexes

- `date_start` - For upcoming events queries
- `category` - For category filtering
- `series_name` - For series filtering
- `venue_city` - For location filtering
- `is_active` - For active events
- Full-text search on `title`

## Setup Instructions

### 1. Install Dependencies

```bash
npm install fast-xml-parser
```

### 2. Configure Environment Variables

Add to `.env.local`:

```env
# Optional: Override default P1 XML feed URLs
NEXT_SECRET_P1_EVENTS_FEED_URL=https://travelware-backend-files-production.s3.eu-central-1.amazonaws.com/8n4477jwzxq0w15e77wnxmuf6183l6zf3ik4mk64zms7mln.xml
NEXT_SECRET_P1_TICKETS_FEED_URL=https://travelware-backend-files-production.s3.eu-central-1.amazonaws.com/udaics0gg9tl2jp7rrdnn6o0730jbz4z02f57y1nm199htg.xml
```

### 3. Create Database Table

Run the SQL schema in your Supabase dashboard:

```bash
# Copy schema from db.schema.sql (p1_events section)
# Execute in Supabase SQL Editor
```

### 4. Initial Sync

1. Navigate to `/p1-events` in the backoffice
2. Click "Sync Now" button
3. Wait for sync to complete (progress shown in console)

## XML Feed Structure

### Events Feed

```xml
<events>
  <event>
    <event_id>01984190-7842-7c4c-97f4-6144c9a64f25</event_id>
    <checkout_link>https://b2b.checkout.travelflow.com/...</checkout_link>
    <title>England Football vs Serbia Football</title>
    <category>FOOTBALL</category>
    <compare_price_ticket_only/>
    <compare_price_ticket_hotel/>
    <series>
      <id>da090200-e0d5-4816-80d3-f9f07423ed8f</id>
      <name>World Cup Qualification 2025-2026</name>
    </series>
    <has_available_tickets>true</has_available_tickets>
    <is_advertisable>true</is_advertisable>
    <date_start>2025-11-13 19:45:00</date_start>
    <date_end/>
    <date_confirmed>true</date_confirmed>
    <stock>10</stock>
    <venue>
      <name>Wembley</name>
      <location>
        <lat>51.5566938</lat>
        <lng>-0.2796424</lng>
      </location>
      <country_code>GB</country_code>
      <city>London</city>
    </venue>
  </event>
</events>
```

### Tickets Feed

```xml
<tickets>
  <ticket>
    <checkout_link>https://b2b.checkout.travelflow.com/...</checkout_link>
    <id>a669c4d4-eec4-4e06-8b30-4a18561f47f9</id>
    <event_id>00341db7-31a2-4432-ac91-31206b5bb369</event_id>
    <tags>
      <tag>hospitality</tag>
    </tags>
    <seatingplan_category_name>Winter Essentials (FSK) - Cat C</seatingplan_category_name>
    <currency>EUR</currency>
    <price_ticket>728.00</price_ticket>
    <price_ticket_hotel>835.00</price_ticket_hotel>
    <seatingplan_category_image>https://...</seatingplan_category_image>
    <seatingplan_category_description>Official Category C event ticket...</seatingplan_category_description>
    <category>Winter Essentials (FSK) - Cat C</category>
    <stock>10</stock>
    <possible_ticket_types>["Mobile"]</possible_ticket_types>
  </ticket>
</tickets>
```

## Event Creation Workflow

When creating an event from P1 data:

1. **Fetch Latest Exchange Rates**

   - Ensures accurate currency conversion

2. **Filter Tickets**

   - Only tickets with `stock > 0`

3. **Currency Conversion to USD**

   - USD: `price + $40` (markup only)
   - EUR: `(price + €40) → USD`
   - GBP: `(price + £35) → USD`

4. **Price Rounding**

   - Round to nearest $10 minus $1
   - Examples: $129, $139, $199

5. **Map to Internal Event Structure**

   - Vendor: "P1Tickets"
   - Location: Use P1 lat/lng coordinates
   - Category: Use P1 category as tag

6. **Smart Date Calculation**

   - Departure: 2 days before event (avoid Fri/Sat)
   - Return: 1 day after event (avoid Sat)

7. **Navigate to Event Creation Form**
   - Pre-populated with P1 data
   - User can review and adjust before saving

## UI Features

### Hierarchical Filtering

- **Categories** → **Series** → **Cities** → **Events** → **Tickets**
- Each selection filters subsequent columns
- Dynamic options based on available data

### Search & Sort

- Full-text search on each column
- Sort by title, price, stock, etc.
- Configurable sort order (asc/desc)

### Pagination

- Configurable page sizes (10-30 items)
- Shows current page and total items
- Previous/Next navigation

### Sync Status

- Shows total events count
- Category breakdown with counts
- Last sync timestamp

## API Usage Examples

### Fetch All Events

```typescript
import { getP1Events } from "@/lib/actions/p1-events-actions";

const events = await getP1Events();
```

### Filter by Category

```typescript
const footballEvents = await getP1EventsByCategory("FOOTBALL");
```

### Filter by Series

```typescript
const worldCupEvents = await getP1EventsBySeries(
  "World Cup Qualification 2025-2026"
);
```

### Get Event with Tickets

```typescript
const event = await getP1EventById("01984190-7842-7c4-97f4-6144c9a64f25");
const tickets = event.tickets; // Already embedded
```

### Trigger Sync

```typescript
import { triggerP1Sync } from "@/lib/actions/p1-events-actions";

await triggerP1Sync();
```

## Sync Process Details

### Filtering Rules

1. **Future Events Only**: `date_start > now()`
2. **Advertisable**: `is_advertisable === true`
3. **Available Tickets**: `has_available_tickets === true`

### Batch Processing

- Events synced in batches of 500
- Prevents timeout and memory issues
- Progress logged to console

### Error Handling

- Failed sync returns error status
- Detailed error logging
- Frontend displays error toast

## Troubleshooting

### Sync Fails

1. Check console logs for detailed error
2. Verify XML feed URLs are accessible
3. Check Supabase connection
4. Verify table schema matches types

### No Events Showing

1. Run sync first (click "Sync Now")
2. Check if events are future-dated
3. Verify `is_advertisable` and `has_available_tickets` flags
4. Check database directly in Supabase

### Tickets Not Loading

1. Tickets are embedded in event records
2. Check if event has `tickets` JSONB field populated
3. Verify tickets have `stock > 0`

## Maintenance

### Regular Tasks

- **Weekly Sync**: Recommended to keep data fresh
- **Cleanup Old Events**: Remove past events periodically
- **Monitor Feed URLs**: Ensure XML feeds are accessible

### Database Maintenance

```sql
-- Remove past events
DELETE FROM p1_events WHERE date_start < NOW() - INTERVAL '7 days';

-- Reset sync status
UPDATE p1_events SET is_active = true WHERE is_active = false;
```

## Comparison with LiveTickets

| Feature                 | P1 Tickets              | LiveTickets                         |
| ----------------------- | ----------------------- | ----------------------------------- |
| Data Format             | XML                     | JSON API                            |
| Event Classification    | Category-based          | Sports/Music classification         |
| Series Support          | ✅ Yes                  | ❌ No                               |
| Hierarchical Categories | 1 level                 | 3 levels                            |
| Performers              | ❌ No                   | ✅ Yes                              |
| Venues                  | Single per event        | Array                               |
| Ticket Types            | Tags (hospitality, vip) | Seating methods (GA, Doubles, etc.) |
| Currency                | EUR, GBP, USD           | EUR, GBP, ILS, USD                  |

## Future Enhancements

- [ ] Add event detail page (`/p1-events/[id]`)
- [ ] Support for ticket images in UI
- [ ] Price comparison between ticket_only and ticket_hotel
- [ ] Filter by tags (hospitality, vip, etc.)
- [ ] Export events to CSV
- [ ] Automated sync scheduling (cron job)
- [ ] Event change notifications
- [ ] Integration with ticket price sync service

## Support

For issues or questions:

1. Check console logs for errors
2. Review this documentation
3. Compare with LiveTickets implementation
4. Check Supabase database directly
