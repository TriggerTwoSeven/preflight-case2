# Pre-Flight: shipment booking checker (Case 2)

Conversational booking + pre-flight error checker for UK to EU pallet shipments.
Live: https://preflight-case2.vercel.app/

**Principle: the model advises, the code decides.** An optional language model (Gemini) only reads the
wording of a chat message. All ten rules, the pallet-weight check and the carrier choice are plain
deterministic code in `public/engine.js`. With no API key the chat falls back to a rule-based parser.

## Run it locally (2 minutes)

You need Node 18+ (https://nodejs.org). No install step, no database.

    cd preflight-case2
    npm start            # serves ./public at http://localhost:3000
    npm test             # engine + parser tests, no dependencies

`npm start` serves the static page, so the chat uses the built-in parser. To also run the optional
Gemini endpoint locally, copy `.env.example` to `.env`, add a key, then `npm run dev` (needs a free
Vercel account and `npx vercel login` the first time).

## Deploy your own copy on Vercel

Option A, dashboard: push this folder to a GitHub repo, then Vercel > Add New Project > import it.
Framework preset: Other. No build command. Vercel serves `public/` and `api/chat.js` automatically.

Option B, CLI: `npx vercel --prod` from this folder.

Optional chat model: Project > Settings > Environment Variables > add `GEMINI_API_KEY`
(and optionally `GEMINI_MODEL`), then redeploy.

### Rotating the Gemini key

No key is stored in this repo (`.env` is git-ignored). The endpoint reads `GEMINI_API_KEYS` (one or many keys, separated by commas, spaces or new lines) and also the older `GEMINI_API_KEY`.
It rotates between them and, if one is revoked, over quota or invalid, skips it for a minute and uses the next, so a rotation never causes downtime:

1. Create a new key in Google AI Studio.
2. Add it to `GEMINI_API_KEYS` next to the current one, redeploy.
3. Delete the old key in Google AI Studio, then remove it from `GEMINI_API_KEYS`.

If every key fails the chat quietly falls back to the built-in parser, so the page never shows an error. The page says "optional language model".
The link has no login, no paywall and no database, so it stays up without any maintenance.

## Files

| File | What it does |
|---|---|
| `public/index.html` | Page structure: chat, upload, results list, slide-over, dialogs |
| `public/styles.css` | All styling: design tokens, light and dark, status colour fields, print styles. Archivo font is loaded from Google Fonts (SIL OFL) |
| `public/app.js` | UI behaviour: chat, upload, report (verdict, carrier table, delivery day strip, paperwork), Fix it buttons, Ctrl/Cmd+K menu |
| `public/engine.js` | Rules R-01 to R-10, carrier ranking (Cheapest / Fastest / Most reliable / Balanced by minimax regret), holiday-aware ETA, one-click fixes, paperwork checklist |
| `public/parser.js` | Rule-based extraction from chat text, missing-field questions, workbook helpers |
| `public/xlsxlite.js` | Tiny .xlsx reader and writer (no libraries) |
| `public/testdata.js` | The 19-booking test file, template and expected results |
| `public/carriers.json` | The fixed rate card (Carriers A, B, C) |
| `api/chat.js` | Optional Vercel serverless function calling Gemini to extract fields |
| `test/` | Node assert tests (engine, parser, key failover); `ui.js` is a Playwright browser test (`npm i -g playwright`, then `NODE_PATH=$(npm root -g) node test/ui.js`) |

## The rulebook (fixed for this case)

Red (any one = **Blocked**, shown as "Can't ship yet"): R-01 HS code at least 6 digits; R-02 declared value =
sum of qty x unit price within 1%; R-03 units per carton x cartons = quantity; R-04 booking cartons = sum of
item cartons; R-05 gross weight / pallets within a carrier limit (400, 500 or 750 kg); R-06 no lithium, aerosol
or flammable goods.
Besides the rules, a Notes line appears when the seller's priority would pick a carrier that is too heavy for the load, with what it would take (more pallets) to use it. Notes never change the status.

Amber (only amber = **At risk**, "Ship with care"): R-07 gross weight >= sum of unit weight x qty; R-08 warehouse
delivery needs an appointment; R-09 every item has a country of origin; R-10 ready date today or later.
Nothing flagged = **Ready to book** ("Good to go").

Rate card (GBP per pallet to DE / FR / NL, transit, on-time, max kg per pallet):
A Road economy 180/170/160, 5 days, 92%, 500 · B Road standard 220/210/200, 3 days, 95%, 750 ·
C Road express 340/330/320, 2 days, 98%, 400.

Allowed values: origins London, Manchester, Birmingham, Leeds; destinations Berlin, Frankfurt, Hamburg (DE),
Paris, Lyon (FR), Amsterdam, Rotterdam (NL); GBP only; item origins UK, China, India, Vietnam, Turkey, Germany.
Dates are DD-MM-YYYY.

## Known limits

National public holidays only, hardcoded to Dec 2027. VAT rates in the paperwork pack are reference only.
No live market prices. The demo "Confirm booking" button contacts nobody.
