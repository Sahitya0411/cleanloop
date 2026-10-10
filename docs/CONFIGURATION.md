# Configuration reference

Every setting CleanLoop reads, where it is set, and its default. You rarely need more than the deploy variables in [section 1](#1-deploy-npm-run-deploy).

## 1. Deploy (`npm run deploy`)

Environment variables read by [`scripts/deploy.sh`](../scripts/deploy.sh):

| Variable                     | Default                                 | Effect                                                                             |
| ---------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------- |
| `AWS_PROFILE`                | your CLI default                        | Credentials to deploy with (use the `cleanloop` profile)                           |
| `AWS_REGION`                 | `AWS_DEFAULT_REGION`, else `ap-south-1` | Region for everything                                                              |
| `STAGE`                      | `dev`                                   | Stack name `cleanloop-<stage>`; lowercase letters, digits and `-`, 2–12 characters |
| `SENDER_EMAIL`               | empty (no emails)                       | SES From address → template `SenderEmail`                                          |
| `OFFICER_EMAIL`              | `SENDER_EMAIL`                          | Ward officer inbox → `OfficerEmail`                                                |
| `MANAGE_SES_IDENTITIES`      | template default `true`                 | `false` = don't create SES identities (already verified)                           |
| `BEDROCK_MODEL_ID`           | template default                        | → `BedrockModelId`                                                                 |
| `BEDROCK_FALLBACK_MODEL_IDS` | template default                        | → `BedrockFallbackModelIds`                                                        |
| `BEDROCK_REGION`             | stack region                            | → `BedrockRegion`                                                                  |
| `LOCATION_MODE`              | template default `amazon`               | → `LocationMode`                                                                   |
| `KM_PER_LITRE`               | template default `3`                    | → `KmPerLitre`                                                                     |
| `DEMO_TOOLS`                 | template default `true`                 | → `DemoTools`                                                                      |
| `DEMO_LOGINS`                | `true`                                  | Put demo-login buttons (and the demo password) into the web app                    |
| `RESEED`                     | `false`                                 | `true` = rebuild the demo ward data                                                |

## 2. CloudFormation template parameters

From [`infra/template.yaml`](../infra/template.yaml):

| Parameter                 | Default                                                         | Meaning                                                                                                                                                          |
| ------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Stage`                   | `dev`                                                           | Resource name suffix                                                                                                                                             |
| `SenderEmail`             | `''`                                                            | SES sender; empty disables email                                                                                                                                 |
| `OfficerEmail`            | `''`                                                            | Stored on the demo ward at seed time; receives report emails                                                                                                     |
| `ManageSesIdentities`     | `true`                                                          | Create `AWS::SES::EmailIdentity` for the addresses above                                                                                                         |
| `BedrockModelId`          | `anthropic.claude-opus-5-5`                                     | Primary Claude model (Bedrock Messages endpoint)                                                                                                                 |
| `BedrockFallbackModelIds` | `anthropic.claude-haiku-4-5,global.anthropic.claude-sonnet-4-6` | Comma-separated models tried next. Ids with a `global.`/`us.`/`apac.`/`eu.` prefix or a `-vN` suffix use the InvokeModel API; the rest use the Messages endpoint |
| `BedrockRegion`           | `''` (= stack region)                                           | Where Bedrock calls go                                                                                                                                           |
| `LocationMode`            | `amazon`                                                        | `amazon` = Amazon Location truck routing; `estimate` = straight line × 1.35                                                                                      |
| `KmPerLitre`              | `3`                                                             | Truck fuel efficiency for the diesel/CO₂ estimates                                                                                                               |
| `DemoTools`               | `true`                                                          | Allows `POST /officer/demo/reset-today`                                                                                                                          |

## 3. Lambda environment

Set by the template (`Globals.Function.Environment`) for all four functions:

| Variable                                                           | Value                                                 |
| ------------------------------------------------------------------ | ----------------------------------------------------- |
| `STAGE`                                                            | `Stage`                                               |
| `TABLE_NAME`                                                       | The DynamoDB table                                    |
| `PHOTO_BUCKET`                                                     | The S3 photo bucket                                   |
| `LANE_TOPIC_ARN`                                                   | The SNS lane-alert topic                              |
| `SENDER_EMAIL`                                                     | `SenderEmail`                                         |
| `APP_URL`                                                          | `https://main.<amplify-domain>` (used in email links) |
| `BEDROCK_MODEL_ID`, `BEDROCK_FALLBACK_MODEL_IDS`, `BEDROCK_REGION` | From the parameters                                   |
| `LOCATION_MODE`, `KM_PER_LITRE`, `DEMO_TOOLS`                      | From the parameters                                   |
| `NODE_OPTIONS`                                                     | `--enable-source-maps` (readable stack traces)        |

Also read by the code, but not set by the template (useful for experiments; set them in the Lambda console):

| Variable                     | Effect                                                       |
| ---------------------------- | ------------------------------------------------------------ |
| `AI_MODE=mock`               | Use the file-name mock AI instead of Bedrock and Rekognition |
| `REKOGNITION_FALLBACK=false` | Don't fall back to Rekognition                               |
| `WEATHER_MODE=off`           | Don't call Open-Meteo when planning                          |

## 4. Local API (`npm run dev`, `npm run start:local -w backend`)

| Variable           | Default                   | Effect                                                                                                                                    |
| ------------------ | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`             | `8787`                    | API port                                                                                                                                  |
| `LOCAL_BASE_URL`   | `http://localhost:<PORT>` | Base of photo upload/view URLs (set to your LAN IP for phone testing)                                                                     |
| `APP_URL`          | `http://localhost:5173`   | Links inside the (recorded) emails                                                                                                        |
| `OFFLINE=1`        | off                       | Skip the Open-Meteo forecast                                                                                                              |
| `LOCAL_AI=bedrock` | mock                      | Use real Claude on Bedrock (needs `AWS_PROFILE`/`AWS_REGION`; honours `BEDROCK_MODEL_ID`, `BEDROCK_FALLBACK_MODEL_IDS`, `BEDROCK_REGION`) |

## 5. Web app (Vite, `frontend/`)

Read at **build time** from `frontend/.env.local` (local dev), or from `frontend/.env.production.local` (written by the deploy; takes precedence in production builds). A template is in [`frontend/.env.example`](../frontend/.env.example).

| Variable                   | Default                 | Meaning                                                             |
| -------------------------- | ----------------------- | ------------------------------------------------------------------- |
| `VITE_AUTH_MODE`           | `local`                 | `local` = demo tokens for the local API; `cognito` = Amazon Cognito |
| `VITE_API_URL`             | `http://localhost:8787` | API base URL                                                        |
| `VITE_AWS_REGION`          | `ap-south-1`            | Cognito and Amazon Location region                                  |
| `VITE_USER_POOL_ID`        | empty                   | Cognito user pool (informational)                                   |
| `VITE_USER_POOL_CLIENT_ID` | empty                   | Cognito app client used for sign-in calls                           |
| `VITE_MAPS_API_KEY`        | empty                   | Amazon Location key; empty = OpenStreetMap tiles                    |
| `VITE_DEMO_PASSWORD`       | empty                   | Password for the demo buttons (cognito mode)                        |
| `VITE_DEMO_EMAILS`         | empty                   | JSON, e.g. `{"resident":"resident@cleanloop.example",...}`          |

In `cognito` mode, demo buttons only appear when both demo variables are set.

## 6. Scripts and tests

| Variable                        | Used by            | Meaning                                                            |
| ------------------------------- | ------------------ | ------------------------------------------------------------------ |
| `STACK_NAME`                    | `seed`, `add-user` | Stack to target if `--stack` isn't given (default `cleanloop-dev`) |
| `SENDER_EMAIL`, `OFFICER_EMAIL` | `check:aws`        | SES identities to check                                            |
| `DAYS`                          | `backtest`         | Days to evaluate (default 28)                                      |
| `PW_CHROMIUM_PATH`              | `e2e`, `icons`     | Use an already-installed Chromium instead of Playwright's download |
| `SCREENSHOTS_DIR`               | `e2e`              | Absolute folder to save a screenshot of every key screen           |
| `DYNAMODB_ENDPOINT`             | backend tests      | Enables the DynamoDB Local suite (set by `npm run test:dynamo`)    |

Command-line flags:

| Command                 | Flags                                                                                                           |
| ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| `npm run seed -- …`     | `--stack <name>`, `--reseed`                                                                                    |
| `npm run add-user -- …` | `--stack <name>`, `--email`, `--name`, `--role resident\|driver\|officer\|recycler`, `--assign-route` (drivers) |

## 7. Constants in code

These change behaviour but are not environment settings; edit them and redeploy.

| What                                        | Where                                                   | Value                                    |
| ------------------------------------------- | ------------------------------------------------------- | ---------------------------------------- |
| Risk weights and saturation                 | `backend/src/core/risk.ts`                              | 30/25/20/15/10; levels at 35 and 65      |
| Deferral rule                               | `backend/src/core/planner.ts` (`DEFAULT_PLAN_OPTIONS`)  | Score < 20, at most a third of the lanes |
| CO₂ per litre, lane speed, loading time     | `backend/src/core/savings.ts`                           | 2.68 kg, 12 km/h, 6 min                  |
| Low-confidence threshold                    | `shared/src/waste.ts`                                   | 0.6                                      |
| Bin labels and instructions (English/Hindi) | `shared/src/waste.ts`                                   | SWM Rules 2026 streams + e-waste         |
| AI prompts and tool schemas                 | `backend/src/core/ai-schema.ts`                         | n/a                                      |
| AI time budget                              | `backend/src/services/bedrock-ai.ts` (`DEFAULT_BUDGET`) | 18 s total, 12 s per model               |
| Recycler match radius                       | `backend/src/domain/pickups.ts` (`NEARBY_KM`)           | 10 km                                    |
| Nightly schedule                            | `infra/template.yaml` (`NightlyPlanFunction`)           | `cron(0 22 * * ? *)`, Asia/Kolkata       |
| Demo ward, lanes, route, recyclers          | `backend/src/seed/seed-data.ts`                         | DTU area                                 |
