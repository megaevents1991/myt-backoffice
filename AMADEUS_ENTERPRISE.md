# Amadeus Enterprise API — onboarding & migration guide (backoffice)

This repo migrated off the `amadeus` npm SDK (Self-Service, being deprecated) to the
**Amadeus Enterprise REST API**, called directly over `fetch`. Backoffice uses the
`NEXT_SECRET_` env prefix. The flight-price search lives in
`app/api/flights/search/route.ts` and uses `app/api/flights/amadeusClient.ts`.

> The sibling `myt---main` repo has the same migration (without the `NEXT_SECRET_` prefix).

---

## 1. What you need from Amadeus for Developers

From the Enterprise workspace:
**https://developers.amadeus.com/my-enterprise-ws/rest**

1. Log in → **My Enterprise Workspace** → **REST apps**.
2. Open the **"Mega events"** app (Status: **Test**).
3. Copy from the app detail page:
   - **API Key**  → `client_id`
   - **API Secret** → `client_secret` (reveal/show)
   - **Host / base URL** (if shown)
   - **Office ID** (candidate `GOT 259889`, if shown)
4. Confirm enabled APIs include **Flight Offers Search** (`GET /v2/shopping/flight-offers`).

The app is already provisioned for **test** — no extra request to start.

---

## 2. Authentication (OAuth2 client_credentials)

POST key+secret to the token endpoint, get a bearer `access_token` (~30 min). The client
(`amadeusClient.ts`) handles + caches this automatically; you only set env values.

### Manual token test

```bash
curl -X POST "https://test.api.amadeus.com/v1/security/oauth2/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id=YOUR_API_KEY&client_secret=YOUR_API_SECRET"
```

### Manual API test

```bash
curl "https://test.api.amadeus.com/v2/shopping/flight-offers?originLocationCode=TLV&destinationLocationCode=BCN&departureDate=2026-08-01&returnDate=2026-08-05&adults=1&max=5&currencyCode=USD" \
  -H "Authorization: Bearer ACCESS_TOKEN_FROM_ABOVE"
```

---

## 3. Fill the env

Copy `.env.amadeus.example` into `.env.local` and fill values.

| Variable | Meaning |
|----------|---------|
| `NEXT_SECRET_AMADEUS_ENV` | `test` or `enterprise` |
| `NEXT_SECRET_AMADEUS_AUTH_HOST` | OAuth token host |
| `NEXT_SECRET_AMADEUS_API_HOST` | Flight APIs host |
| `NEXT_SECRET_AMADEUS_CLIENT_ID` | API Key |
| `NEXT_SECRET_AMADEUS_CLIENT_SECRET` | API Secret |
| `NEXT_SECRET_AMADEUS_OFFICE_ID` | optional Office ID |

---

## 4. Going to production

1. Validate on **test** (event flight-price search populates `base_flight_price`).
2. Submit Amadeus QA / certification (go-live) form.
3. On approval, Amadeus promotes **"Mega events"** Test → Production.
4. Set `NEXT_SECRET_AMADEUS_ENV=enterprise` + production host/creds, redeploy.

Rollback: flip env back to the working set — no code change.
