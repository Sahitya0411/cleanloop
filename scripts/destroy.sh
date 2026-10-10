#!/usr/bin/env bash
# Deletes the CleanLoop stack and everything in it (photos, data, users).
#   AWS_PROFILE=cleanloop STAGE=dev npm run destroy
set -euo pipefail

STAGE="${STAGE:-dev}"
export AWS_REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-ap-south-1}}"
STACK="cleanloop-${STAGE}"

read -r -p "Delete stack $STACK in $AWS_REGION, including all photos, reports and users? Type the stack name to confirm: " answer
[ "$answer" = "$STACK" ] || { echo "Cancelled."; exit 1; }

BUCKET="$(aws cloudformation describe-stack-resource --stack-name "$STACK" --logical-resource-id PhotosBucket \
  --query StackResourceDetail.PhysicalResourceId --output text 2>/dev/null || true)"
if [ -n "$BUCKET" ] && [ "$BUCKET" != "None" ]; then
  echo "Emptying s3://$BUCKET"
  aws s3 rm "s3://$BUCKET" --recursive --quiet
fi
aws cloudformation delete-stack --stack-name "$STACK"
echo "Waiting for deletion…"
aws cloudformation wait stack-delete-complete --stack-name "$STACK"
echo "Deleted $STACK. The artifact bucket cleanloop-artifacts-<account>-$AWS_REGION is kept; delete it by hand if you like."
