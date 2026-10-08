# Developer guide

How the code is organised and how to make common changes. Set up first with [LOCAL_SETUP.md](LOCAL_SETUP.md).

## Code map

```
shared/src/            Imported by backend and frontend
  types.ts             The API contract: every request/response type
  waste.ts             Waste streams, bins (EN/HI), materials, pickup eligibility
  time.ts, geo.ts      IST calendar days, distances, map links

backend/src/
  api/routes.ts        Every HTTP route: method, path, allowed roles, Zod validation
  api/router.ts        Tiny router: role checks, error → HTTP status mapping
  domain/              Use cases: sorting, reports, collection (driver + alerts),
                       planning (risk + routes), pickups, insights (home, overview, impact)
  core/                Pure logic, no I/O: eta, risk, planner, savings, notify-rules,
                       ai-schema (prompts + tool schemas), rekognition-map, wards
  data/                kv.ts (interface), dynamo-kv.ts, memory-kv.ts, repo.ts (key design)
  services/            AWS adapters (Bedrock, Rekognition, S3, SNS/SES, Location,
                       Open-Meteo, CloudWatch EMF) + local stand-ins + the AppContext type
  handlers/            Lambda entry points: api, stream, nightly, post-confirmation;
                       aws-context.ts wires the real services
  local/               Dev server, in-memory runtime with a simulated stream, backtest
  seed/                Demo data, AWS seeding, add-user, preflight checks

frontend/src/
  App.tsx              Routes per role (lazy-loaded) with role guards
  pages/{resident,driver,officer,recycler}/   Screens
  components/          Shell (nav), MapView (MapLibre), PhotoCapture (camera/upload),
                       EtaCard, StatusTracker, AlertsSheet, LanePicker, ui primitives
  lib/                 api.ts (typed client), auth.ts (Cognito over fetch + local demo),
                       image.ts (compress + presigned upload), i18n + strings (EN/HI),
                       hooks (data loading with polling), session, toast, format, weather
  styles/global.css    Design tokens and all styles

infra/template.yaml    All AWS resources (SAM)
scripts/               build-lambdas, deploy, destroy, dev, make-icons
```

## How a request flows

```
Browser → lib/api.ts → API Gateway (JWT authorizer) → handlers/api.ts
        → api/router.ts (role check) → api/routes.ts (Zod) → domain/* → data/repo.ts + services/*
```

Locally, `local/server.ts` replaces API Gateway and the handler, with the same router, domain and repo code. `local/context.ts` swaps DynamoDB for `MemoryKv` (which also simulates the DynamoDB stream that triggers resident alerts), S3/SNS/SES for in-memory stand-ins, and Bedrock for `MockAi`.

Business logic depends only on `AppContext` (`services/types.ts`), never on an AWS SDK directly, so every flow is testable without AWS.

## Recipes

### Add an API endpoint

1. Add request/response types to `shared/src/types.ts` if the frontend needs them.
2. Write the use case in `backend/src/domain/<area>.ts`, taking `(ctx: AppContext, user: AuthUser, input)`. Throw `badRequest`, `forbidden`, `notFound` or `conflict` from `domain/common.ts` for expected errors.
3. Register it in `backend/src/api/routes.ts`: `r.add('POST', '/thing/:id', ['resident'], (req, ctx) => doThing(ctx, req.user, parse(Schema, req.body)))`. Static paths must come before `:param` paths that would match them (e.g. `/reports/mine` before `/reports/:id`).
4. Add a client method in `frontend/src/lib/api.ts`.
5. Add a test in `backend/test/api.test.ts` (it calls the router directly; see the `call()` helper).

API Gateway already forwards every `GET/POST/PUT/DELETE /{proxy+}`, so there is no infrastructure change.

### Add a screen

1. Create `frontend/src/pages/<role>/MyScreen.tsx`, starting with `<TopBar title=… back="/<role>" />`.
2. Add a lazy import and a `<Route>` in `frontend/src/App.tsx`, wrapped in `<Phone role="…">` (phone roles) or `<Guard role="officer">`.
3. To put it in the bottom navigation, add it to `NAV` in `frontend/src/components/Shell.tsx` (or `OFFICER_NAV`).

### Add or change UI text

Resident, driver and recycler text goes in `frontend/src/lib/strings.ts`: add the key to `en` **and** `hi` (TypeScript enforces the key; a test enforces matching `{placeholders}`). Use it with `const { t } = useI18n(); t('my.key', { n: 3 })`. The officer dashboard is English-only and uses plain strings.

### Store something new in DynamoDB

All key design lives in `backend/src/data/repo.ts` (see the table at the top). Add `xxxItem()`, `putXxx()` and `getXxx()` methods there, reusing `pk`/`sk` and the two GSIs (`gsi1pk/gsi1sk`, `gsi2pk/gsi2sk`). Every item needs an `entity` attribute. Only use `KvStore` operations (`get`, `put`, `update`, `query`, `queryIndex`, `batchPut`, `delete`) so the in-memory store keeps working. Use `update(..., { expect })` or `put(..., { ifNotExists })` for anything two people could change at once.

### Change the AI behaviour

- Prompts, tool schemas and validation: `backend/src/core/ai-schema.ts`
- Model call, fallback order and time budget: `backend/src/services/bedrock-ai.ts`
- Low-confidence threshold: `LOW_CONFIDENCE_THRESHOLD` in `shared/src/waste.ts`
- Local mock answers (file-name keywords): `backend/src/services/mock-ai.ts`
- Rekognition rules: `backend/src/core/rekognition-map.ts`

Test against real Claude locally with `LOCAL_AI=bedrock AWS_PROFILE=cleanloop npm run dev`.

### Tune the risk score or route planning

Weights live in `backend/src/core/risk.ts` and deferral rules in `backend/src/core/planner.ts`. Run `npm run backtest` before and after, and update `backend/test/core.test.ts` if behaviour changes on purpose.

### Change the demo ward

Edit `backend/src/seed/seed-data.ts`:

- `LANES`: name, area, lat/lng, `marketDays` (0 = Sunday)
- `BASELINE_ORDER`: the old fixed route (savings are measured against it)
- `BUSY_LANES` and `NARROW_LANES`: how often the synthetic history overflows or skips
- Recyclers, pickups and festival dates

Locally, restart the API. On AWS: `RESEED=true npm run deploy`. Keep `DEMO_LANE_ID` pointing at an existing lane; tests use it.

### Add an AWS permission or resource

Add it to `infra/template.yaml` (the function's `Policies`), run `cfn-lint --regions ap-south-1 -- infra/template.yaml`, and if the deployer needs a new action to create it, add that to `infra/deployer-policy.json`.

## Conventions

- TypeScript `strict` with `noUncheckedIndexedAccess`; no `any`.
- Pure logic goes in `core/` with unit tests; I/O stays in `services/` and `data/`.
- Every user-facing failure gets a clear message: throw a typed error from `domain/common.ts` for the API; use `toast(…, 'error')` or `<ErrorState>` in the UI.
- Dates are IST calendar days (`istDate`, `addDays` from `@cleanloop/shared`); timestamps are ISO UTC strings.
- Formatting: Prettier (single quotes, 100 columns); linting: ESLint (`npm run lint`).
- Before a commit: `npm run check && npm run format:check`; for UI changes also `npm run e2e`.
