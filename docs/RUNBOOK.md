# Runbook: operating the deployed app

For the hackathon week and demo day. Examples use stage `dev` (stack `cleanloop-dev`) in `ap-south-1` with `AWS_PROFILE=cleanloop` exported.

```bash
export AWS_PROFILE=cleanloop AWS_REGION=ap-south-1 STACK=cleanloop-dev
fn() { aws cloudformation describe-stack-resource --stack-name "$STACK" --logical-resource-id "$1" \
  --query StackResourceDetail.PhysicalResourceId --output text; }
```

`fn ApiFunction`, `fn StopStreamFunction`, `fn NightlyPlanFunction`, `fn PostConfirmationFunction`, `fn DataTable` and `fn PhotosBucket` print the real resource names.

## Where to look

| What                            | Where                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------ |
| App URL, API URL, dashboard URL | `.deploy/outputs.json` (written by the deploy)                                       |
| Demo logins                     | `.deploy/demo-users.json`                                                            |
| Metrics                         | CloudWatch dashboard `cleanloop-<stage>` (`DashboardUrl` output)                     |
| Errors alarm                    | CloudWatch alarm `cleanloop-<stage>-api-errors` (≥ 5 API Lambda errors in 5 minutes) |
| Logs (14-day retention)         | `aws logs tail /aws/lambda/$(fn ApiFunction) --follow --since 15m`                   |
| Data                            | DynamoDB console → table `$(fn DataTable)` → _Explore items_                         |
| Photos                          | S3 console → bucket `$(fn PhotosBucket)` → `uploads/`                                |

Every log line is one JSON object (`level`, `message`, `time`, `stage`, details), so CloudWatch JSON filters work. Useful filters:

```bash
aws logs tail /aws/lambda/$(fn ApiFunction) --since 1h --filter-pattern '{ $.level = "error" }'
aws logs tail /aws/lambda/$(fn ApiFunction) --since 1h --filter-pattern 'bedrock'      # model fallbacks
aws logs tail /aws/lambda/$(fn ApiFunction) --since 1h --filter-pattern 'email'        # SES problems
aws logs tail /aws/lambda/$(fn StopStreamFunction) --since 1h                          # lane alerts
aws logs tail /aws/lambda/$(fn NightlyPlanFunction) --since 1d                         # nightly plan
```

Custom metrics (namespace `CleanLoop`, dimension `Stage`): `ItemsSorted`, `LowConfidenceSorts`, `ManualSorts`, `SortFailures`, `ReportsFiled`, `HighSeverityReports`, `OfficerEmailsSent`, `ReportsResolved`, `StopsDone`, `StopsSkipped`, `LaneAlertsSent`, `AlertSubscriptions`, `PickupsRequested`, `PickupsAccepted`, `PickupsCompleted`, `RecyclersRegistered`, `RoutesPlanned`, `KmSavedPlanned`.

## Routine actions

| Action                                  | How                                                                                                                |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Run tonight's planning now              | Officer → **Run tonight's plan now**; or `aws lambda invoke --function-name $(fn NightlyPlanFunction) /dev/stdout` |
| Reset today's route (all stops pending) | Officer → **Routes** → **Reset today (demo)**                                                                      |
| Confirm the nightly schedule            | EventBridge console → _Schedules_ → the `NightlyPlanFunction` schedule (22:00 Asia/Kolkata)                        |
| Add a driver/officer                    | `npm run add-user -- --stack $STACK --email … --name … --role driver --assign-route`                               |
| Disable a user                          | Cognito console → user pool `cleanloop-<stage>` → user → _Disable_                                                 |
| Rebuild demo data                       | `npm run seed -- --stack $STACK --reseed`                                                                          |
| See who subscribed to lane alerts       | SNS console → topic `cleanloop-<stage>-lane-alerts` → _Subscriptions_                                              |
| Check API health                        | `curl "$(node -p "require('./.deploy/outputs.json').ApiUrl")/health"`                                              |

## Demo-day checklist

The night before:

- [ ] `npm run deploy` from the final code; open the app URL on the phone you'll record with
- [ ] `npm run check:aws` shows ✔ for the Claude model and the SES identities
- [ ] Send one test report: the officer email arrives with the photo
- [ ] Resident account subscribed to email alerts (confirmed)
- [ ] Objects and photos ready (see [DEMO_SCRIPT.md](DEMO_SCRIPT.md))

Just before recording:

- [ ] Officer → Routes → **Reset today (demo)**, so the driver starts at 0 stops
- [ ] Officer → **Run tonight's plan now**, so the risk list is fresh
- [ ] Phone: switch off notifications from other apps; set brightness high
- [ ] Laptop: open the officer dashboard, the email inbox and the CloudWatch dashboard in tabs

After judging:

- [ ] `DEMO_LOGINS=false npm run deploy` (removes the public demo password)
- [ ] When you're done with the project: `npm run destroy`

## Incidents

| Symptom                                          | Likely cause                                                   | Fix                                                                                           |
| ------------------------------------------------ | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Sort results say "Checked by Amazon Rekognition" | Claude call failing (no model access, throttling)              | Logs: filter `bedrock`; enable the model or `BEDROCK_MODEL_ID=… npm run deploy`               |
| Sort says "Couldn't identify" every time         | Bedrock _and_ Rekognition failing                              | Logs: filter `error`; run `npm run check:aws`                                                 |
| No officer email                                 | SES identity not verified, or the sandbox blocks the recipient | Verify both addresses; logs: filter `email`                                                   |
| Residents get no "2 stops away"                  | Stream Lambda failing, or alerts not subscribed/confirmed      | `aws logs tail /aws/lambda/$(fn StopStreamFunction)`; check the SNS subscriptions             |
| Map blank on the site                            | Maps key referer restriction                                   | Use the exact Amplify URL (`main.<id>.amplifyapp.com`)                                        |
| "No route is assigned to you" for a driver       | Driver account isn't on the route                              | `npm run add-user -- … --role driver --assign-route`                                          |
| Tomorrow's risk list is empty                    | The nightly job hasn't run yet                                 | Officer → **Run tonight's plan now** (the dashboard also plans automatically if it's missing) |
| 401 errors / sudden sign-outs                    | Expired refresh token (30 days) or a deleted user              | Sign in again                                                                                 |
| Errors alarm in ALARM state                      | API Lambda throwing                                            | `aws logs tail … --filter-pattern '{ $.level = "error" }'`                                    |
