#!/usr/bin/env bash
# Deploys CleanLoop end to end: Lambdas + infrastructure (SAM template via
# CloudFormation), demo data, and the web app on Amplify Hosting.
#
#   AWS_PROFILE=cleanloop SENDER_EMAIL=you@gmail.com OFFICER_EMAIL=officer@gmail.com npm run deploy
#
# Optional: STAGE (dev), AWS_REGION (ap-south-1), BEDROCK_MODEL_ID, BEDROCK_FALLBACK_MODEL_IDS,
#           LOCATION_MODE (amazon|estimate), DEMO_LOGINS (true|false), RESEED (true|false),
#           MANAGE_SES_IDENTITIES (true|false: false if the emails are already verified in SES),
#           KM_PER_LITRE (truck fuel assumption, default 3), DEMO_TOOLS (true|false, officer "Reset today")
# Needs: AWS CLI v2, Node.js 20+, zip, curl. See AWS_SETUP.md for permissions.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

STAGE="${STAGE:-dev}"
export AWS_REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-ap-south-1}}"
export AWS_DEFAULT_REGION="$AWS_REGION"
STACK="cleanloop-${STAGE}"
SENDER_EMAIL="${SENDER_EMAIL:-}"
OFFICER_EMAIL="${OFFICER_EMAIL:-$SENDER_EMAIL}"
DEMO_LOGINS="${DEMO_LOGINS:-true}"
DEPLOY_DIR="$ROOT/.deploy"
mkdir -p "$DEPLOY_DIR"

step() { printf '\n\033[1;32m▶ %s\033[0m\n' "$*"; }
need() { command -v "$1" >/dev/null || { echo "Missing $1. $2"; exit 1; }; }
need aws "Install AWS CLI v2: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html"
need node "Install Node.js 20 or newer."
need zip "Install zip."
need curl "Install curl."
json() { node -e "const o=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log($1 ?? '')"; }

step "Checking credentials"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
echo "Account $ACCOUNT, region $AWS_REGION, stack $STACK${AWS_PROFILE:+, profile $AWS_PROFILE}"
[ -z "$SENDER_EMAIL" ] && echo "Note: SENDER_EMAIL is not set, so no emails will be sent (reports still work)."

step "Installing dependencies and building Lambda bundles"
[ -d node_modules ] || npm ci
npm run build:lambdas

step "Packaging (artifact bucket)"
ARTIFACTS="cleanloop-artifacts-${ACCOUNT}-${AWS_REGION}"
if ! aws s3api head-bucket --bucket "$ARTIFACTS" 2>/dev/null; then
  if [ "$AWS_REGION" = "us-east-1" ]; then
    aws s3api create-bucket --bucket "$ARTIFACTS" >/dev/null
  else
    aws s3api create-bucket --bucket "$ARTIFACTS" --create-bucket-configuration "LocationConstraint=$AWS_REGION" >/dev/null
  fi
  aws s3api put-public-access-block --bucket "$ARTIFACTS" \
    --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
fi
aws cloudformation package --template-file infra/template.yaml --s3-bucket "$ARTIFACTS" \
  --s3-prefix "$STACK" --output-template-file infra/packaged.yaml >/dev/null

step "Deploying the stack (first run takes ~5 minutes)"
STATUS="$(aws cloudformation describe-stacks --stack-name "$STACK" --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo NONE)"
if [ "$STATUS" = "ROLLBACK_COMPLETE" ]; then
  # A failed first deploy leaves an empty stack that can only be deleted.
  echo "Previous first deploy failed ($STATUS); deleting the empty stack before retrying."
  aws cloudformation delete-stack --stack-name "$STACK"
  aws cloudformation wait stack-delete-complete --stack-name "$STACK"
fi
PARAMS=("Stage=$STAGE" "SenderEmail=$SENDER_EMAIL" "OfficerEmail=$OFFICER_EMAIL")
[ -n "${MANAGE_SES_IDENTITIES:-}" ] && PARAMS+=("ManageSesIdentities=$MANAGE_SES_IDENTITIES")
[ -n "${BEDROCK_MODEL_ID:-}" ] && PARAMS+=("BedrockModelId=$BEDROCK_MODEL_ID")
[ -n "${BEDROCK_FALLBACK_MODEL_IDS:-}" ] && PARAMS+=("BedrockFallbackModelIds=$BEDROCK_FALLBACK_MODEL_IDS")
[ -n "${BEDROCK_REGION:-}" ] && PARAMS+=("BedrockRegion=$BEDROCK_REGION")
[ -n "${LOCATION_MODE:-}" ] && PARAMS+=("LocationMode=$LOCATION_MODE")
[ -n "${KM_PER_LITRE:-}" ] && PARAMS+=("KmPerLitre=$KM_PER_LITRE")
[ -n "${DEMO_TOOLS:-}" ] && PARAMS+=("DemoTools=$DEMO_TOOLS")
aws cloudformation deploy --template-file infra/packaged.yaml --stack-name "$STACK" \
  --capabilities CAPABILITY_IAM CAPABILITY_AUTO_EXPAND --no-fail-on-empty-changeset \
  --tags project=cleanloop stage="$STAGE" \
  --parameter-overrides "${PARAMS[@]}"

aws cloudformation describe-stacks --stack-name "$STACK" --query 'Stacks[0].Outputs' --output json \
  | node -e "const o=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(JSON.stringify(Object.fromEntries(o.map(x=>[x.OutputKey,x.OutputValue])),null,2))" \
  > "$DEPLOY_DIR/outputs.json"
out() { json "o.$1" < "$DEPLOY_DIR/outputs.json"; }
API_URL="$(out ApiUrl)"; APP_URL="$(out AppUrl)"; APP_ID="$(out AmplifyAppId)"
MAPS_KEY="$(aws location describe-key --key-name "$(out MapsApiKeyName)" --query Key --output text)"

step "Seeding demo users and the DTU demo ward"
SEED_ARGS=(--stack "$STACK")
[ "${RESEED:-false}" = "true" ] && SEED_ARGS+=(--reseed)
SENDER_EMAIL="$SENDER_EMAIL" npm run seed -w backend -- "${SEED_ARGS[@]}"

step "Building the web app"
{
  echo "VITE_AUTH_MODE=cognito"
  echo "VITE_API_URL=$API_URL"
  echo "VITE_AWS_REGION=$AWS_REGION"
  echo "VITE_USER_POOL_ID=$(out UserPoolId)"
  echo "VITE_USER_POOL_CLIENT_ID=$(out UserPoolClientId)"
  echo "VITE_MAPS_API_KEY=$MAPS_KEY"
  if [ "$DEMO_LOGINS" = "true" ]; then
    echo "VITE_DEMO_PASSWORD=$(json o.password < "$DEPLOY_DIR/demo-users.json")"
    echo "VITE_DEMO_EMAILS=$(json 'JSON.stringify(o.emails)' < "$DEPLOY_DIR/demo-users.json")"
  fi
} > frontend/.env.production.local
npm run build -w frontend

step "Publishing to Amplify Hosting"
(cd frontend/dist && rm -f "$DEPLOY_DIR/site.zip" && zip -qr "$DEPLOY_DIR/site.zip" .)
DEPLOYMENT="$(aws amplify create-deployment --app-id "$APP_ID" --branch-name main --output json)"
JOB_ID="$(echo "$DEPLOYMENT" | json o.jobId)"
UPLOAD_URL="$(echo "$DEPLOYMENT" | json o.zipUploadUrl)"
curl -sS --fail -X PUT -H "Content-Type: application/zip" -T "$DEPLOY_DIR/site.zip" "$UPLOAD_URL" >/dev/null
aws amplify start-deployment --app-id "$APP_ID" --branch-name main --job-id "$JOB_ID" >/dev/null
JOB_STATUS="PENDING"
for _ in $(seq 1 120); do
  JOB_STATUS="$(aws amplify get-job --app-id "$APP_ID" --branch-name main --job-id "$JOB_ID" --query 'job.summary.status' --output text)"
  case "$JOB_STATUS" in
    SUCCEED) break ;;
    FAILED | CANCELLED) echo "Amplify deployment $JOB_STATUS (job $JOB_ID)"; exit 1 ;;
  esac
  sleep 5
done
[ "$JOB_STATUS" = "SUCCEED" ] || echo "Amplify job $JOB_ID is still $JOB_STATUS; check the Amplify console."


step "Done"
echo "App:        $APP_URL"
echo "API:        $API_URL"
echo "Dashboard:  $(out DashboardUrl)"
if [ "$DEMO_LOGINS" = "true" ]; then
  echo "Demo users: one-tap buttons on the login page (credentials in .deploy/demo-users.json)"
fi
if [ -n "$SENDER_EMAIL" ]; then
  if [ "$OFFICER_EMAIL" = "$SENDER_EMAIL" ] || [ -z "$OFFICER_EMAIL" ]; then
    echo "Email:      click the verification link AWS sent to $SENDER_EMAIL (check Spam too)"
  else
    echo "Email:      click the verification links AWS sent to $SENDER_EMAIL and $OFFICER_EMAIL (check Spam too)"
  fi
fi
echo "Check:      AWS_REGION=$AWS_REGION SENDER_EMAIL=$SENDER_EMAIL npm run check:aws"
