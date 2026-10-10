# CleanLoop architecture

## Request flows

### Sort (Snap to Sort)

1. The browser shrinks the photo to at most 1600 px (JPEG) and asks `POST /uploads {purpose: "sort"}` for a presigned **S3 POST**. S3 itself enforces the key, the image content type and an 8 MB cap.
2. The browser uploads straight to S3, then calls `POST /sort {photoKey}`.
3. The API Lambda checks the key belongs to the caller (`uploads/sort/<userId>/…`), reads the object and sends it to Claude through `AnthropicBedrockMantle` (the Anthropic SDK's client for the Bedrock Messages endpoint) with a `record_sort` tool, `tool_choice: auto` and `effort: low`. The tool input is validated with Zod.
4. Fallback order: the configured model, then each fallback model (on error, refusal or invalid output), then Rekognition `DetectLabels` mapped to streams by rules, then a "choose the bin yourself" answer. Plain model ids go to the Messages endpoint (`AnthropicBedrockMantle`); inference-profile or versioned ids (`global.…`, `…-v1:0`) go to `bedrock-runtime` InvokeModel (`AnthropicBedrock`). All calls share an 18 s budget so the fallbacks always fit inside the Lambda timeout. Below 0.6 confidence the UI asks for a retake or a manual choice.
5. The result is stored on the user (`SORT#…`) for impact stats; the CloudWatch metric `ItemsSorted` is emitted through EMF.

### Collect (driver taps → resident alerts)

1. `POST /driver/stops/:seq/done|skip` updates the stop with a **conditional write** (`status = pending`), so a double tap returns 409.
2. DynamoDB Streams delivers the `MODIFY` (event filter: `entity = STOP`) to the stream Lambda.
3. `messagesForStopChange` decides who to tell: the lane now 2 stops away (plus the next lane on the first tap of the day), or the skipped lane ("missed today, reason…"). Every message is stored in the lane's in-app feed; "truck near" and "missed" also go to the **SNS** lane topic, where each subscription has a `laneId` filter policy.
4. ETAs are computed on read from the stops (`core/eta.ts`), so every screen sees the same recalculated times.

### Report

1. Same presigned upload (`purpose: report`), then `POST /reports {photoKey, lat, lng, note}`.
2. Severity triage (`record_severity`) is cached per photo for a day, so "Send anyway" does not pay for a second model call.
3. If the model is confident the photo shows no bin or dump, the API returns `created: false` and the UI offers Retake or Send anyway.
4. The point is matched to a ward (radius around the ward centre) and its nearest lane; outside every ward, the resident's chosen lane is used and the report says so.
5. The report is written and the ward officer gets an **SES** raw MIME email with the photo inline, severity, hazards, note, a Google Maps link and a deep link to the inbox.
6. The officer opening the report marks it _seen_; _Resolve_ requires an after-photo (`purpose: resolve`). The resident's tracker shows both, and the resident is emailed when possible.

### Predict and save (nightly)

1. EventBridge Scheduler fires the nightly Lambda at 22:00 Asia/Kolkata.
2. For each ward: fetch the Open-Meteo rain forecast for tomorrow, compute each lane's five factors from 8 weeks of reports and 14 days of stops (`core/risk.ts`), and store the scores.
3. `core/planner.ts` orders the route: high risk first, then nearest neighbour; lanes defer only under strict rules (under 20, collected within a day, no open report, not an event day, at most a third of the route).
4. Baseline (fixed order) and optimised routes are both measured with Amazon Location `CalculateRoutes` (`TravelMode: Truck`). If either call fails, both fall back to the estimate so the comparison stays fair. Leg durations plus 6 minutes of loading give each stop's `avgMinutesToNext`.
5. Runs already under way are never replanned. Officers can run the same job on demand.

### Recycle

`POST /pickups` validates the material against the item type, finds the nearest consenting recycler (within 10 km) who buys that material and emails them. Accept and Done are conditional writes (`status = open`, then `status = accepted AND recyclerId = me`), so two recyclers can't take the same job.

## Data model (single DynamoDB table)

| Entity                       | pk                    | sk                     | GSI1 (pk / sk)                     | GSI2 (pk / sk)                 |
| ---------------------------- | --------------------- | ---------------------- | ---------------------------------- | ------------------------------ |
| Ward                         | `WARD#<id>`           | `META`                 | `WARDS` / id                       |                                |
| Lane                         | `LANE#<id>`           | `META`                 | `WARD#<w>#LANES` / name            |                                |
| Risk score                   | `LANE#<id>`           | `RISK#<date>`          | `RISK#<w>#<date>` / lane           |                                |
| Alert subscription           | `LANE#<id>`           | `SUB#<user>#<channel>` |                                    | `USER#<user>` / `SUB#…`        |
| Lane notification (TTL 14 d) | `LANE#<id>`           | `NOTIF#<ts>#<id>`      |                                    |                                |
| Route                        | `ROUTE#<id>`          | `META`                 | `WARD#<w>#ROUTES` / id             |                                |
| Route run                    | `ROUTE#<id>`          | `RUN#<date>`           | `WARD#<w>#RUNS` / `date#route`     |                                |
| Stop                         | `RUN#<route>#<date>`  | `STOP#<seq>`           | `LANE#<lane>#STOPS` / `date#route` |                                |
| Report                       | `REPORT#<id>`         | `META`                 | `WARD#<w>#REPORTS` / createdAt     | `USER#<reporter>` / `REPORT#…` |
| AI analysis cache (TTL 1 d)  | `ANALYSIS#<photoKey>` | `META`                 |                                    |                                |
| Pickup request               | `PICKUP#<id>`         | `META`                 | `PICKUPS` / createdAt              | `USER#<resident>` / `PICKUP#…` |
| Recycler                     | `RECYCLER#<id>`       | `META`                 | `RECYCLERS` / name                 |                                |
| Profile                      | `USER#<id>`           | `PROFILE`              |                                    |                                |
| Sort result                  | `USER#<id>`           | `SORT#<ts>#<id>`       | `SORTS#<date>` / ts                |                                |

Every item carries `entity`, which the stream's event filter uses. All dates are IST calendar days (`shared/src/time.ts`).

## Code structure

- `backend/src/core`: pure logic (ETA, risk, planner, savings, alert rules, AI schemas and prompts, Rekognition mapping, ward lookup), fully unit-tested.
- `backend/src/domain`: use cases (sorting, reports, collection, planning, pickups, insights) written against an `AppContext` of interfaces.
- `backend/src/services`: AWS adapters (Bedrock, Rekognition, S3, SNS/SES, Location, Open-Meteo, CloudWatch EMF) and local stand-ins.
- `backend/src/data`: a minimal key-value interface with `DynamoKv` (AWS) and `MemoryKv` (local and tests, with a simulated stream); `Repo` holds the key design.
- `backend/src/handlers`: Lambda entry points (API, stream, nightly, Cognito post-confirmation).
- `backend/src/local`: the dev server (same router and domain code, in-memory data, mock AI) and the backtest.

The same router serves API Gateway and the local server, so `npm run dev`, the integration tests and production all exercise identical code paths.

## Security notes

- The API Gateway JWT authorizer verifies Cognito ID tokens; the router checks the role (from `cognito:groups`) on every route.
- People can only self-register as residents or recyclers; the post-confirmation trigger ignores any other requested role.
- Uploads go through presigned POST with an exact key, content-type and size policy. The API only accepts photo keys under the caller's own prefix for the matching purpose.
- The photo bucket is private (Block Public Access, SSE-S3, TLS-only policy); photos are served through 1-hour presigned GET URLs.
- The officer's email address never leaves the server (`publicWard`).
- The maps key is read-only, restricted to map actions and to the app's domain.
- MapLibre popups use `setText`, never HTML, so user text can't inject markup.
- Demo logins are a convenience for judging; turn them off with `DEMO_LOGINS=false`.
