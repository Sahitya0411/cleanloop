# Blog draft: AWS Builder Center

> Draft for the team to rewrite in your own voice before publishing. Add your names, a photo from the build days, and what actually went wrong for you. Real stories beat polished ones.

## Title ideas

- Closing Delhi's waste loop with Claude on Amazon Bedrock and a DynamoDB stream
- From "which bin?" to "truck is 2 stops away": building CleanLoop in four days on AWS

## Outline

**1. The problem we picked (Track 03: Waste and Energy).**
Since April 2026, households have had to split waste into four streams (wet, dry, sanitary, special care), yet most people don't know which bin an item goes in. Collection is reactive, trucks drive fixed routes, and the kabadiwalas who already recycle so much are invisible online. We scoped it to one ward near DTU so we could build the whole loop and not just one screen.

**2. What CleanLoop does.** One PWA, four roles:

- Residents snap an item to learn the bin, see a live truck ETA, report an overflowing bin with one photo, and book a recycler pickup.
- Drivers tap Done or Skip on big buttons, in Hindi.
- Ward officers get a severity-ranked inbox, a risk forecast, and tomorrow's reordered route with km, diesel and CO₂ saved.
- Recyclers accept nearby pickups.

**3. The architecture.** Include the diagram from the README. Points worth explaining:

- _Presigned S3 POST_ instead of PUT, so S3 enforces size and content type before our code runs.
- _Claude on Bedrock with tool use._ We ask for a `record_sort` tool call and validate it with Zod. Low confidence means we ask the user, not guess. If the primary model is unavailable we fall back to a second model, then to Rekognition labels.
- _DynamoDB Streams → Lambda → SNS._ The driver's tap is just a conditional write; the stream does the fan-out. One SNS topic with a per-lane filter policy instead of a topic per lane.
- _EventBridge Scheduler at 22:00 IST_ scores every lane, reorders tomorrow's route and measures both routes with Amazon Location truck routing.
- _One SAM template_ for everything; a local dev server runs the same router with an in-memory store and a mock AI, so the UI could be built before AWS was set up.

**4. The risk score.** Show the five factors and weights. Explain the backtest (`npm run backtest`) and be honest that the demo history is synthetic.

**5. Challenges (fill in your own).** Candidates:

- Getting MapLibre's web worker to load after bundling with Vite.
- Making ETAs believable when the truck runs late (we restart the clock from "now" and say "Running late").
- SMS to Indian numbers needs DLT registration, so we leaned on email and in-app alerts.
- Designing for drivers: Hindi by default, 64 px buttons, Skip always asks why.

**6. What we'd do next.** Live GPS from the truck, a SageMaker model trained on real ward data, WhatsApp alerts, and onboarding real kabadiwalas with consent.

**7. Try it.** Repo link, demo video link, and the three-command local quickstart from the README.
