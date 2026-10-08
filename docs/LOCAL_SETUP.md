# Run CleanLoop on your laptop

This runs the whole app (all four roles) with **no AWS account**: an in-memory database seeded with the DTU demo ward, a mock AI, and local stand-ins for S3, SNS and SES. It takes about 5 minutes.

## 1. Prerequisites

| Tool             | Version                                | Check           | Install                                         |
| ---------------- | -------------------------------------- | --------------- | ----------------------------------------------- |
| Node.js          | 20.19+ or 22.12+ (tested on 22 and 26) | `node -v`       | https://nodejs.org (LTS) or `brew install node` |
| npm              | 10+ (comes with Node)                  | `npm -v`        | n/a                                             |
| Git              | any                                    | `git --version` | `brew install git` / https://git-scm.com        |
| A modern browser | Chrome, Edge, Firefox or Safari        | n/a             | n/a                                             |

Only for optional tasks:

| Tool                                                 | Needed for                                                                                          |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Docker                                               | `npm run test:dynamo` (DynamoDB Local) and `sam local invoke`                                       |
| Python 3.10+ with `pip install cfn-lint aws-sam-cli` | Template validation (`cfn-lint`, `sam validate`)                                                    |
| AWS CLI v2 plus an AWS profile                       | Deploying, or running locally with real Claude ([section 6](#6-use-real-claude-on-bedrock-locally)) |

## 2. Install

```bash
git clone <your-repo-url> cleanloop
cd cleanloop
npm ci
```

`npm ci` installs all three workspaces (`shared`, `backend`, `frontend`) from `package-lock.json`. It may print `install scripts not yet covered by allowScripts` for `esbuild` and `fsevents`; that warning is harmless because the prebuilt binaries are used.

## 3. Start

```bash
npm run dev
```

This starts two processes:

| Process        | URL                   | Notes                                                                                                  |
| -------------- | --------------------- | ------------------------------------------------------------------------------------------------------ |
| Local API      | http://localhost:8787 | Same router and business logic as the Lambda. Reloads (and **re-seeds**) on every backend file change. |
| Web app (Vite) | http://localhost:5173 | Hot reload.                                                                                            |

Open **http://localhost:5173** and pick a role under **Try the demo as**. Stop both with `Ctrl+C`.

Useful local URLs:

- http://localhost:8787/health: API health check
- http://localhost:8787/local/outbox: every SNS lane alert, SES email and subscription the app _would_ have sent, newest first

## 4. What you can do locally

| Role     | Account                       | Try                                                                                                   |
| -------- | ----------------------------- | ----------------------------------------------------------------------------------------------------- |
| Resident | Heer, lane _Pocket D, Lane 4_ | Snap to Sort, Report a bin, Request pickup, Track the truck, switch to हिन्दी (the **अ** button)      |
| Driver   | Ramesh Kumar (opens in Hindi) | Tap **Done** and **Skip**, then watch the resident's alerts and the outbox                            |
| Officer  | Ward Officer                  | Reports inbox, Resolve with after-photo, Run tonight's plan now, Risk prediction, Routes, Reset today |
| Recycler | Sunil Kabadiwala              | Accept a nearby pickup, then Mark done in My jobs                                                     |

Data lives in memory: restarting the API (or editing backend code) resets everything to the seeded demo state.

### The mock AI reads file names

Locally there is no model, so the **file name** of the photo you upload picks the answer. The Upload button works on desktop; the camera works too, but camera photos are always named `camera.jpg` and sort as a plastic bottle.

| File name contains                                    | Snap to Sort result                      |
| ----------------------------------------------------- | ---------------------------------------- |
| `banana`, `peel`, `food`, `fruit`, `vegetable`, `tea` | Wet waste (banana peel)                  |
| `phone`, `laptop`, `charger`, `cable`, `ewaste`       | E-waste (charger), pickup offered        |
| `battery`, `cell`                                     | E-waste (battery)                        |
| `bulb`, `paint`, `medicine`, `tablet`, `thermometer`  | Special-care waste                       |
| `diaper`, `pad`, `sanitary`, `tissue`                 | Sanitary waste                           |
| `box`, `cardboard`, `carton`                          | Dry (cardboard), pickup offered          |
| `can`, `tin`, `metal`                                 | Dry (metal), pickup offered              |
| `blurry`, `unknown`, `selfie`                         | Low confidence: retake or choose the bin |
| anything else                                         | Dry (plastic bottle), pickup offered     |

| File name contains               | Report a bin result                              |
| -------------------------------- | ------------------------------------------------ |
| `selfie`, `cat`, `dog`, `flower` | "Doesn't look like a bin" (Retake / Send anyway) |
| `small`, `full`, `low`           | Low severity                                     |
| `dump`, `fire`, `burn`, `drain`  | High severity (blocking drain, animals)          |
| anything else                    | Medium severity                                  |

Any small JPEG or PNG works; rename copies such as `banana.jpg` or `dump.jpg`.

## 5. Variations

**Offline (no internet).** The backend fetches a rain forecast from Open-Meteo when planning. To skip it:

```bash
OFFLINE=1 npm run dev
```

The resident's weather card and the map tiles also need internet; everything else works offline.

**Run the two halves separately** (for example, to see each one's logs):

```bash
npm run dev -w backend                                                  # terminal 1: API on :8787
VITE_AUTH_MODE=local VITE_API_URL=http://localhost:8787 npm run dev -w frontend   # terminal 2: web on :5173
```

**Use a phone on the same Wi-Fi.** Find your laptop's LAN IP (macOS: `ipconfig getifaddr en0`; Windows: `ipconfig`), then:

```bash
# terminal 1 (the API listens on all interfaces)
LOCAL_BASE_URL=http://192.168.1.20:8787 npm run start:local -w backend
# terminal 2
cd frontend && VITE_AUTH_MODE=local VITE_API_URL=http://192.168.1.20:8787 npx vite --host
```

Open `http://192.168.1.20:5173` on the phone. Browsers only allow the live camera on HTTPS or `localhost`, so on the phone use **Upload**, which still offers "Take photo". For the full camera experience, use the deployed HTTPS site.

## 6. Use real Claude on Bedrock locally

With an AWS profile that can call Bedrock (see [AWS_SETUP.md](../AWS_SETUP.md)):

```bash
LOCAL_AI=bedrock AWS_PROFILE=cleanloop AWS_REGION=ap-south-1 npm run dev
```

The data stays in memory; only sorting and severity go to Claude (Opus 5.5, then Haiku 4.5). To try a different model, add `BEDROCK_MODEL_ID=anthropic.claude-sonnet-5`. Photo results then show _Checked by Claude on Amazon Bedrock_.

## 7. Production build locally

```bash
npm run build          # Lambda bundles into backend/dist/<function>/index.mjs + web app into frontend/dist
npm run preview -w frontend   # serves frontend/dist on http://localhost:4173
```

Settings are baked in at build time. After you have deployed once, `frontend/.env.production.local` (written by the deploy) wins, and the build points at AWS. Otherwise the build uses `frontend/.env.local` or the local-mode defaults; keep `npm run dev -w backend` running for the API.

## 8. Troubleshooting

| Problem                                    | Fix                                                                                                                  |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `Port 5173 is in use` / `EADDRINUSE :8787` | Another dev server is running. Stop it, or find it with `lsof -i :5173` / `lsof -i :8787`.                           |
| Login page has no demo buttons             | `VITE_AUTH_MODE` is `cognito` without demo credentials. Delete `frontend/.env.local`, or set `VITE_AUTH_MODE=local`. |
| "No connection" toasts                     | The API isn't running, or `VITE_API_URL` points somewhere else. Check http://localhost:8787/health.                  |
| Map is grey                                | Map tiles need internet (OpenStreetMap locally). Wait a second for tiles.                                            |
| Data disappeared                           | Expected: local data is in memory and resets when the API restarts.                                                  |
| `node: bad option` or syntax errors        | Node is older than 20.19. Upgrade Node.                                                                              |
