# Testing CleanLoop

## Quick reference

| Command                            | Time              | Needs                     | Covers                                                             |
| ---------------------------------- | ----------------- | ------------------------- | ------------------------------------------------------------------ |
| `npm run check`                    | ~20 s             | n/a                       | Typecheck + lint + all unit/integration tests + production build   |
| `npm run format:check`             | ~3 s              | n/a                       | Prettier formatting                                                |
| `npm test`                         | ~3 s              | n/a                       | 111 unit and integration tests (shared 6, backend 88, frontend 17) |
| `npm run test:dynamo`              | ~10 s             | Docker                    | The API flows against DynamoDB Local (4 more tests)                |
| `npm run e2e`                      | ~30 s             | A Chromium for Playwright | 5 end-to-end journeys in a phone-sized browser                     |
| `npm run backtest`                 | ~3 s              | n/a                       | Risk-score accuracy for several weight settings                    |
| `cfn-lint` / `sam validate --lint` | ~5 s              | Python tools              | The CloudFormation/SAM template                                    |
| `sam local invoke`                 | ~1 min first time | Docker + SAM CLI          | The bundled Lambda in the real Node.js 22 runtime                  |

Before pushing, run `npm run check && npm run format:check` (CI runs these too).

## Unit and integration tests (Vitest)

```bash
npm test                                         # everything
npm test -w backend                              # one workspace
npm test -w backend -- test/core.test.ts         # one file
npm test -w backend -- -t "ETA"                  # tests whose name matches
cd backend && npx vitest                         # watch mode while coding
```

| File                                          | What it tests                                                                                                                                                                                                                                                                             |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared/test/shared.test.ts`                  | IST date maths, distances, pickup eligibility                                                                                                                                                                                                                                             |
| `backend/test/core.test.ts`                   | ETA (start, taps, late, collected/missed/deferred), risk weights and levels, route planner (high risk first, deferral rules and cap), savings maths, alert rules, Rekognition label mapping, ward lookup, AI output parsing                                                               |
| `backend/test/data.test.ts`                   | In-memory store semantics; DynamoDB expression building, conditional writes, pagination, consistent reads, batch retries (mocked SDK)                                                                                                                                                     |
| `backend/test/services.test.ts`               | Claude on Bedrock (request shape, tool parsing, model fallback, time budget), fallback chain, MIME email, SNS/SES adapters, presigned POST policy, Amazon Location routing and fallback, Open-Meteo, Cognito claim parsing, local tokens                                                  |
| `backend/test/api.test.ts`                    | Every API flow through the real router against the seeded demo ward: access control, sort and manual choice, report → officer email → seen → resolve, driver taps → lane alerts, stream de-duplication, planning and its race protections, pickups and conflicts, alerts, profile, impact |
| `backend/test/dynamodb-local.test.ts`         | Home screens, conditional writes, GSIs and planning on a real DynamoDB engine (skipped unless `DYNAMODB_ENDPOINT` is set)                                                                                                                                                                 |
| `frontend/src/lib/lib.test.ts`                | Every English string has a Hindi translation with the same placeholders; Cognito token parsing; local demo tokens; phone normalisation; AQI bands; driver ETAs                                                                                                                            |
| `frontend/src/lib/auth.test.ts`               | Token refresh: offline keeps the session, a revoked token ends it                                                                                                                                                                                                                         |
| `frontend/src/components/components.test.tsx` | Truck ETA card states, report status tracker                                                                                                                                                                                                                                              |

## DynamoDB Local

```bash
npm run test:dynamo
```

This starts `amazon/dynamodb-local` in Docker on port 8000, runs the backend tests with `DYNAMODB_ENDPOINT=http://localhost:8000` (the extra suite creates a table with the same keys and indexes as the template), then stops the container. Manually:

```bash
docker run -d --rm --name cleanloop-ddb -p 8000:8000 amazon/dynamodb-local
DYNAMODB_ENDPOINT=http://localhost:8000 npm test -w backend
docker stop cleanloop-ddb
```

## End-to-end tests (Playwright)

One-time browser install:

```bash
cd frontend && npx playwright install chromium
```

Run:

```bash
npm run e2e
```

Playwright starts its own local API on **:8790** and web app on **:5180**; those ports must be free. It drives a Pixel 7-sized browser with GPS set to a lane near DTU:

1. **Resident:** home → sort a banana (wet) and a bottle (dry) → request a pickup from the result → low-confidence photo → manual choice → report a dump with GPS (high severity, tracker) → live truck map → Hindi.
2. **Driver:** opens in Hindi → switch to English → Done → Skip with a reason → map.
3. **Officer:** dashboard → run the plan → open the resident's report → resolve with an after-photo → risk and routes pages.
4. **Resident:** sees the after-photo and lane alerts.
5. **Recycler:** opens in Hindi → accept a matched pickup → mark it done.

Options:

```bash
SCREENSHOTS_DIR=/tmp/cleanloop-shots npm run e2e          # save a screenshot of each key screen
PW_CHROMIUM_PATH=/path/to/chrome npm run e2e               # reuse an installed Chromium
cd frontend && npx playwright show-trace test-results/<test>/trace.zip   # inspect a failure
```

## Risk-model backtest

```bash
npm run backtest            # last 28 days
DAYS=56 npm run backtest    # longer window
```

For each past day it scores every lane using only earlier data and checks which lanes really got an overflow report. It prints AUC (0.5 = random, 1 = perfect), how often the day's top-3 lanes had a report, and the precision of medium+high levels. The demo history is synthetic, so treat the numbers as a demonstration of the method; re-run it on real ward data before changing the weights in `backend/src/core/risk.ts`.

## Template checks

```bash
pip install cfn-lint aws-sam-cli
cfn-lint --regions ap-south-1 -- infra/template.yaml
sam validate --lint --template-file infra/template.yaml --region ap-south-1
```

Run the bundled API Lambda in the real runtime (Docker):

```bash
npm run build:lambdas
sam local invoke ApiFunction --template-file infra/template.yaml --event infra/events/health.json             # 200
sam local invoke ApiFunction --template-file infra/template.yaml --event infra/events/officer-forbidden.json  # 403
```

## AWS preflight

```bash
AWS_PROFILE=cleanloop AWS_REGION=ap-south-1 SENDER_EMAIL=you@gmail.com OFFICER_EMAIL=you+officer@gmail.com npm run check:aws
```

This checks credentials, each Claude model (one tiny call each), Rekognition, Amazon Location routing, SES status and identities, and the SNS SMS sandbox.

## CI

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs on every push and pull request: `npm ci`, typecheck, lint, format check, tests, build, cfn-lint, Playwright install and e2e. It uploads Playwright traces when something fails.

## Manual test plan

Use it after a deploy, or before recording the demo. Use a real phone for resident and driver.

**Resident**

- [ ] Login page → **Resident** demo → home shows lane, weather/air quality, truck card
- [ ] Change lane (pin chip) → the ETA updates; the choice survives a reload
- [ ] Snap a plastic bottle → Dry / Blue bin / a sensible tip / ≥ 75% confidence / _Request pickup_
- [ ] Snap a banana peel → Wet / Green bin / no pickup button
- [ ] Snap something ambiguous (blurry photo) → "Not sure" → choose a bin manually
- [ ] **Request pickup** → choose material, weight, phone → appears in _My pickups_ as "Waiting for a recycler"
- [ ] **Report a bin** with location allowed → "Using your location", AI severity, tracker shows _Report sent_
- [ ] Report with location denied → "Location off: using your lane"
- [ ] Photo of a person or room → "Doesn't look like a bin" → Retake / Send anyway
- [ ] **Track** → map with numbered stops, the truck, the route line; next stops list with minutes
- [ ] Profile → Alerts → email on → confirmation email arrives → confirm it
- [ ] **अ** button → screens switch to Hindi; Profile → Language persists

**Driver**

- [ ] Opens in Hindi; big Done/Skip; current stop highlighted; deferred-lanes banner
- [ ] **Done** → progress increases; the resident 2 stops away gets an in-app alert (and email if subscribed)
- [ ] **Skip** → reason required → that lane's resident sees "missed today"
- [ ] Map tab → numbered pins, truck, **Navigate** opens Google Maps directions

**Officer (laptop)**

- [ ] KPIs, reports list, reports map, tomorrow's risk, savings card, today's route progress
- [ ] Report email arrived with the photo inline and a map link; the link opens the report in the inbox
- [ ] Open a _sent_ report → resident's tracker shows _Seen by officer_
- [ ] **Resolve with after-photo** → resident sees the after-photo and note
- [ ] **Run tonight's plan now** → toast with high-risk lanes and km saved; Routes shows the proposed order against the fixed route
- [ ] Risk page: factor bars and "why" text make sense; deferred lanes listed
- [ ] **Reset today (demo)** → driver route back to 0 stops

**Recycler**

- [ ] Register shop (materials, rates, location, consent) on a new recycler account
- [ ] Nearby requests show distance and "Matched to you"; **Accept** → resident sees name and phone with a Call button
- [ ] A second recycler can't accept the same job ("Someone else already took this pickup")
- [ ] My jobs → **Mark done** → resident sees "Picked up"

**Install as an app**

- [ ] Chrome on Android → menu → _Install app_ / _Add to Home screen_ → opens full-screen with the CleanLoop icon
