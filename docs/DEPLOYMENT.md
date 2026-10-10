# Deploy CleanLoop to AWS

One command builds and deploys everything: Lambdas and infrastructure (one SAM template), demo users and data, and the web app on Amplify Hosting. Account, IAM and console prerequisites are in [AWS_SETUP.md](../AWS_SETUP.md); do those first.

## 1. Before the first deploy

- [ ] `npm ci` has been run in the repo
- [ ] AWS CLI v2, `zip` and `curl` are installed (`aws --version`, `zip -v`, `curl --version`)
- [ ] An AWS profile with [`infra/deployer-policy.json`](../infra/deployer-policy.json) exists (this guide calls it `cleanloop`), and you are logged in: `aws sts get-caller-identity --profile cleanloop`
- [ ] Claude is enabled in Amazon Bedrock in `ap-south-1` ([AWS_SETUP.md, step 3](../AWS_SETUP.md#3-enable-claude-in-amazon-bedrock))
- [ ] The preflight passes:
  ```bash
  AWS_PROFILE=cleanloop AWS_REGION=ap-south-1 SENDER_EMAIL=you@gmail.com npm run check:aws
  ```
  It needs ✔ for Credentials, **every `Deploy:` line**, and at least one Claude model. `!` warnings for the SES and SMS sandboxes are fine for the demo. If `Deploy:` lines say _BLOCKED by your AWS Organization_, this account can't host CleanLoop; see [AWS_SETUP.md, section 1](../AWS_SETUP.md#the-account-must-not-be-locked-down-by-an-organisation).

## 2. Deploy

```bash
AWS_PROFILE=cleanloop \
SENDER_EMAIL=you@gmail.com \
OFFICER_EMAIL=you+officer@gmail.com \
npm run deploy
```

The first run takes about 6–8 minutes; later runs take 2–3. At the end it prints:

```
App:        https://main.d1234abcd.amplifyapp.com
API:        https://abc123.execute-api.ap-south-1.amazonaws.com
Dashboard:  https://ap-south-1.console.aws.amazon.com/cloudwatch/...
Demo users: one-tap buttons on the login page (credentials in .deploy/demo-users.json)
```

Then check both inboxes and **click the two "Amazon Web Services – Email Address Verification Request" links**. Until then, no email is sent (everything else works).

### What the script does, step by step

| #   | Step              | Commands                                                                                                                                                                    | Output                                                          |
| --- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 1   | Check credentials | `aws sts get-caller-identity`                                                                                                                                               | Account, region, stack name                                     |
| 2   | Build Lambdas     | `npm run build:lambdas` (esbuild)                                                                                                                                           | `backend/dist/{api,stream,nightly,post-confirmation}/index.mjs` |
| 3   | Package           | Creates bucket `cleanloop-artifacts-<account>-<region>` once, then `aws cloudformation package`                                                                             | `infra/packaged.yaml`                                           |
| 4   | Deploy stack      | `aws cloudformation deploy --stack-name cleanloop-<stage> --capabilities CAPABILITY_IAM CAPABILITY_AUTO_EXPAND` (deletes a leftover `ROLLBACK_COMPLETE` stack first)        | Stack outputs in `.deploy/outputs.json`                         |
| 5   | Maps key          | `aws location describe-key`                                                                                                                                                 | Browser key for map tiles                                       |
| 6   | Seed              | `npm run seed -w backend -- --stack cleanloop-<stage>`: 4 demo Cognito users, the DTU demo ward with 4 weeks of history, today's and tomorrow's plans (via Amazon Location) | `.deploy/demo-users.json`                                       |
| 7   | Build web app     | Writes `frontend/.env.production.local`, runs `npm run build -w frontend`                                                                                                   | `frontend/dist`                                                 |
| 8   | Publish           | Zips `frontend/dist`, then `aws amplify create-deployment` → upload → `start-deployment` → waits for `SUCCEED`                                                              | Live site                                                       |

Everything in `.deploy/`, `infra/packaged.yaml` and `frontend/.env.production.local` is generated and git-ignored.

### Deploy options

All are environment variables for `npm run deploy` (full reference: [CONFIGURATION.md](CONFIGURATION.md)).

| Variable                         | Default                      | Example                                                              |
| -------------------------------- | ---------------------------- | -------------------------------------------------------------------- |
| `STAGE`                          | `dev`                        | `STAGE=parv` gives every teammate their own stack (`cleanloop-parv`) |
| `AWS_REGION`                     | `ap-south-1`                 | Any region with Bedrock, Location and Amplify                        |
| `SENDER_EMAIL` / `OFFICER_EMAIL` | empty / same as sender       | Officer gets new-report emails                                       |
| `BEDROCK_MODEL_ID`               | `anthropic.claude-opus-5-5`  | `anthropic.claude-sonnet-5`                                          |
| `BEDROCK_FALLBACK_MODEL_IDS`     | `anthropic.claude-haiku-4-5` | Comma-separated                                                      |
| `LOCATION_MODE`                  | `amazon`                     | `estimate` skips Amazon Location routing                             |
| `KM_PER_LITRE`                   | `3`                          | Truck fuel assumption for savings                                    |
| `DEMO_LOGINS`                    | `true`                       | `false` removes the demo buttons                                     |
| `DEMO_TOOLS`                     | `true`                       | `false` hides the officer's "Reset today"                            |
| `RESEED`                         | `false`                      | `true` rebuilds the demo ward data                                   |
| `MANAGE_SES_IDENTITIES`          | `true`                       | `false` if the addresses are already verified in SES                 |

On updates, template parameters you don't pass keep their previous values.

## 3. Check that it works (5 minutes)

Open the printed **App** URL on a phone and a laptop:

1. **Resident** demo → home shows _Pocket D, Lane 4_, weather and the truck card.
2. **Snap to Sort** a real object → the result says _Checked by Claude on Amazon Bedrock_. (_Checked by Amazon Rekognition_ means Claude isn't reachable; see [AWS_SETUP.md, troubleshooting](../AWS_SETUP.md#10-troubleshooting).)
3. **Report a bin** with a photo of a bin → AI severity appears, and the officer inbox receives an email with the photo.
4. **Driver** demo (laptop, or a second phone) → tap **Done** twice → the resident's _Latest alerts_ shows "truck is 2 stops away" within a few seconds.
5. **Officer** demo → the report is at the top of the inbox → **Resolve with after-photo** → the resident's _My reports_ shows it resolved.
6. **Recycler** demo → accept a pickup → it appears in _My jobs_.
7. Open the **Dashboard** URL: _Loop activity_ counts your actions (metrics appear within ~5 minutes).

The full manual test plan is in [TESTING.md](TESTING.md#manual-test-plan).

## 4. Day-to-day

| Task                                                     | Command                                                                                                                               |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Redeploy after code changes (backend, infra or frontend) | Same `npm run deploy` command; unchanged parts are skipped                                                                            |
| Add a real driver and give them the route                | `AWS_PROFILE=cleanloop npm run add-user -- --stack cleanloop-dev --email ravi@example.org --name "Ravi" --role driver --assign-route` |
| Add a ward officer                                       | Same, with `--role officer` (no `--assign-route`)                                                                                     |
| Reset today's route before recording                     | Officer → **Routes** → **Reset today (demo)**                                                                                         |
| Re-plan tomorrow now                                     | Officer → **Run tonight's plan now**                                                                                                  |
| Rebuild the demo data                                    | `RESEED=true npm run deploy` (or `npm run seed -w backend -- --stack cleanloop-dev --reseed`)                                         |
| New demo password                                        | Delete `.deploy/demo-users.json`, then `npm run deploy`                                                                               |
| Turn off demo logins after judging                       | `DEMO_LOGINS=false npm run deploy`                                                                                                    |
| Switch Claude model                                      | `BEDROCK_MODEL_ID=anthropic.claude-sonnet-5 npm run deploy`                                                                           |
| Logs, metrics, manual nightly run                        | See [RUNBOOK.md](RUNBOOK.md)                                                                                                          |

`npm run seed`, `npm run add-user` and `npm run check:aws` also need `AWS_PROFILE` and `AWS_REGION` set if they are not your defaults.

## 5. Optional: validate and run the Lambda with SAM CLI

SAM CLI is one of AWS's open-source tools; the template is a SAM template.

```bash
pip install aws-sam-cli            # or: brew install aws-sam-cli
sam validate --lint --template-file infra/template.yaml --region ap-south-1

# Run the bundled API function in the real Node.js 22 Lambda runtime (needs Docker)
npm run build:lambdas
sam local invoke ApiFunction --template-file infra/template.yaml --event infra/events/health.json
sam local invoke ApiFunction --template-file infra/template.yaml --event infra/events/officer-forbidden.json   # expect 403
```

If `sam` asks for credentials, any values work for these offline commands (`AWS_ACCESS_KEY_ID=x AWS_SECRET_ACCESS_KEY=y`).

## 6. Tear down

```bash
AWS_PROFILE=cleanloop STAGE=dev npm run destroy
```

You'll be asked to type the stack name. The script empties the photo bucket and deletes the stack, including users, data, the Amplify site, the maps key and the SES identities it created. The artifact bucket `cleanloop-artifacts-<account>-<region>` is kept; delete it by hand if you like:

```bash
aws s3 rb s3://cleanloop-artifacts-<account>-ap-south-1 --force
```

## 7. If a deploy fails

| Symptom                                         | Fix                                                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------------------------ |
| `Unable to locate credentials` / `ExpiredToken` | `aws sso login --profile cleanloop`, or re-check `AWS_PROFILE`                       |
| `AccessDenied` in a stack event                 | Add the named action to the deployer policy and re-run                               |
| `ROLLBACK_COMPLETE`                             | Just re-run; the script deletes the empty stack first                                |
| `AWS::SES::EmailIdentity ... already exists`    | `MANAGE_SES_IDENTITIES=false npm run deploy`                                         |
| `UPDATE_ROLLBACK_FAILED`                        | Console → CloudFormation → stack → _Continue update rollback_, then re-run           |
| Amplify job `FAILED`                            | Amplify console → app `cleanloop-<stage>` → the failed job's log; re-run the deploy  |
| Seed fails with `ResourceNotFoundException`     | The stack is incomplete; re-run the deploy                                           |
| See the stack's events                          | `aws cloudformation describe-stack-events --stack-name cleanloop-dev --max-items 20` |
