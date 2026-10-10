// Preflight check for an AWS account/profile before (and after) deploying CleanLoop.
//
//   AWS_PROFILE=cleanloop AWS_REGION=ap-south-1 SENDER_EMAIL=you@x.com npm run check:aws
//
// Makes one tiny Claude call per configured model (a few paisa in total), one
// Rekognition call, and one Amazon Location route. Everything else is read-only:
// it asks each service the deploy needs about a resource that doesn't exist, so a
// "not found" answer proves access and an AccessDenied names who is blocking it.

import AnthropicBedrock, { AnthropicBedrockMantle } from '@anthropic-ai/bedrock-sdk';
import { CalculateRoutesCommand, GeoRoutesClient } from '@aws-sdk/client-geo-routes';
import { DetectLabelsCommand, RekognitionClient } from '@aws-sdk/client-rekognition';
import { GetAccountCommand, GetEmailIdentityCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { GetSMSSandboxAccountStatusCommand, SNSClient } from '@aws-sdk/client-sns';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { modelIds } from '../handlers/aws-context';
import { usesInvokeModel } from '../services/bedrock-ai';

type Result = { check: string; ok: boolean | 'warn'; detail: string };
const results: Result[] = [];

async function check(name: string, fn: () => Promise<{ ok?: boolean | 'warn'; detail: string }>) {
  try {
    const r = await fn();
    results.push({ check: name, ok: r.ok ?? true, detail: r.detail });
  } catch (err) {
    const e = err as { name?: string; message?: string };
    results.push({
      check: name,
      ok: false,
      detail: `${e.name ?? 'Error'}: ${e.message ?? String(err)}`.slice(0, 220),
    });
  }
}

function classifyCliError(stderr: string): { ok: boolean | 'warn'; detail: string } {
  if (/service control policy/i.test(stderr)) {
    return { ok: false, detail: 'BLOCKED by your AWS Organization (service control policy)' };
  }
  if (/no identity-based policy|is not authorized to perform/i.test(stderr)) {
    const action = /perform: ([\w:-]+)/.exec(stderr)?.[1];
    return { ok: false, detail: `deployer policy is missing ${action ?? 'an action'}` };
  }
  if (
    /not ?found|does not exist|NoSuchEntity|ResourceNotFound|NoSuchBucket|\(404\)/i.test(stderr)
  ) {
    return { ok: true, detail: 'allowed' };
  }
  if (/Unable to locate credentials|ExpiredToken|InvalidClientTokenId/i.test(stderr)) {
    return { ok: false, detail: 'credentials problem' };
  }
  return { ok: 'warn', detail: stderr.trim().split('\n').pop()!.slice(0, 160) };
}

/** Runs a read-only AWS CLI call (same profile and region) and classifies the answer. */
function cliProbe(args: string[]): Promise<{ ok: boolean | 'warn'; detail: string }> {
  return new Promise((resolve) => {
    execFile(
      'aws',
      [...args, '--output', 'json'],
      { env: { ...process.env, AWS_PAGER: '' } },
      (err, _out, stderr) => {
        if (!err) return resolve({ ok: true, detail: 'allowed' });
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          return resolve({ ok: false, detail: 'AWS CLI not installed' });
        }
        resolve(classifyCliError(stderr || String(err)));
      },
    );
  });
}

async function main() {
  const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'ap-south-1';
  process.env.AWS_REGION = region;
  console.log(
    `Checking AWS access in ${region}${process.env.AWS_PROFILE ? ` with profile ${process.env.AWS_PROFILE}` : ''}…\n`,
  );

  let account = '';
  await check('Credentials (STS)', async () => {
    const id = await new STSClient({}).send(new GetCallerIdentityCommand({}));
    account = id.Account ?? '';
    return { detail: `account ${id.Account}, ${id.Arn}` };
  });

  const probe = 'cleanloop-preflight-probe';
  const deployServices: [string, string[]][] = [
    ['CloudFormation', ['cloudformation', 'describe-stacks', '--stack-name', probe]],
    ['IAM roles', ['iam', 'get-role', '--role-name', probe]],
    ['S3', ['s3api', 'head-bucket', '--bucket', `cleanloop-artifacts-${account}-${region}`]],
    ['Lambda', ['lambda', 'get-function', '--function-name', probe]],
    ['DynamoDB', ['dynamodb', 'describe-table', '--table-name', probe]],
    ['API Gateway', ['apigatewayv2', 'get-apis', '--max-results', '1']],
    ['Cognito', ['cognito-idp', 'list-user-pools', '--max-results', '1']],
    [
      'SNS',
      ['sns', 'get-topic-attributes', '--topic-arn', `arn:aws:sns:${region}:${account}:${probe}`],
    ],
    ['SES', ['sesv2', 'get-email-identity', '--email-identity', 'preflight@cleanloop.example']],
    ['EventBridge Scheduler', ['scheduler', 'get-schedule', '--name', probe]],
    ['Amazon Location (maps key)', ['location', 'describe-key', '--key-name', probe]],
    ['Amplify Hosting', ['amplify', 'list-apps', '--max-results', '1']],
    ['CloudWatch', ['cloudwatch', 'describe-alarms', '--alarm-names', probe]],
    [
      'CloudWatch Logs',
      ['logs', 'describe-log-groups', '--log-group-name-prefix', '/aws/lambda/cleanloop-'],
    ],
  ];
  for (const [name, args] of deployServices) {
    await check(`Deploy: ${name}`, () => cliProbe(args));
  }

  const bedrockRegion = process.env.BEDROCK_REGION || region;
  for (const model of modelIds()) {
    const api = usesInvokeModel(model) ? 'InvokeModel' : 'Messages';
    await check(`Claude (${api}): ${model}`, async () => {
      const Client = usesInvokeModel(model) ? AnthropicBedrock : AnthropicBedrockMantle;
      const client = new Client({
        awsRegion: bedrockRegion,
        maxRetries: 0,
        timeout: 30_000,
      });
      const res = await client.messages.create({
        model,
        max_tokens: 2000,
        messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
      });
      if (res.stop_reason === 'refusal')
        return { ok: false, detail: 'model refused the test prompt' };
      const text = res.content.find((b) => b.type === 'text');
      return {
        detail: `responded (${text && 'text' in text ? text.text.trim().slice(0, 20) : res.stop_reason})`,
      };
    });
  }

  await check('Rekognition DetectLabels (fallback AI)', async () => {
    const icon = await readFile(
      path.resolve(import.meta.dirname, '../../../frontend/public/icons/icon-192.png'),
    );
    const res = await new RekognitionClient({}).send(
      new DetectLabelsCommand({ Image: { Bytes: icon }, MaxLabels: 3 }),
    );
    return { detail: `ok (${res.Labels?.length ?? 0} labels)` };
  });

  await check('Amazon Location truck routing', async () => {
    const res = await new GeoRoutesClient({}).send(
      new CalculateRoutesCommand({
        Origin: [77.1105, 28.7489],
        Destination: [77.1215, 28.7342],
        TravelMode: 'Truck',
      }),
    );
    const leg = res.Routes?.[0]?.Legs?.[0]?.VehicleLegDetails?.Summary?.Overview;
    return { detail: `DTU depot to Sector 17: ${((leg?.Distance ?? 0) / 1000).toFixed(1)} km` };
  });

  const ses = new SESv2Client({});
  await check('SES account', async () => {
    const acct = await ses.send(new GetAccountCommand({}));
    return acct.ProductionAccessEnabled
      ? { detail: 'production access (can email anyone)' }
      : {
          ok: 'warn',
          detail: 'sandbox: only verified addresses can receive email (fine for the demo)',
        };
  });
  for (const email of [process.env.SENDER_EMAIL, process.env.OFFICER_EMAIL].filter(
    Boolean,
  ) as string[]) {
    await check(`SES identity ${email}`, async () => {
      const res = await ses.send(new GetEmailIdentityCommand({ EmailIdentity: email }));
      return res.VerifiedForSendingStatus
        ? { detail: 'verified' }
        : {
            ok: false,
            detail: 'not verified yet: click the link in the email from Amazon Web Services',
          };
    });
  }

  await check('SNS SMS sandbox', async () => {
    const res = await new SNSClient({}).send(new GetSMSSandboxAccountStatusCommand({}));
    return res.IsInSandbox
      ? { ok: 'warn', detail: 'in SMS sandbox: verify each demo phone number, or use email alerts' }
      : { detail: 'SMS production access' };
  });

  const width = Math.max(...results.map((r) => r.check.length));
  for (const r of results) {
    const mark = r.ok === true ? '✔' : r.ok === 'warn' ? '!' : '✘';
    console.log(`${mark} ${r.check.padEnd(width)}  ${r.detail}`);
  }
  const failed = results.filter((r) => r.ok === false);
  const bedrockOk = results.some((r) => r.check.startsWith('Claude') && r.ok === true);
  const scpBlocked = results.filter((r) => r.detail.startsWith('BLOCKED'));
  const deployBlocked = results.filter((r) => r.check.startsWith('Deploy:') && r.ok === false);
  if (scpBlocked.length) {
    console.log(
      `\n✘ This account belongs to an AWS Organization that blocks ${scpBlocked.length} service(s) CleanLoop uses.` +
        '\n  IAM permissions cannot override that. Deploy to an account you control instead:' +
        '\n  see "Account and region" in AWS_SETUP.md.',
    );
  }
  console.log(
    failed.length
      ? `\n${failed.length} check(s) failed. See AWS_SETUP.md for the fix for each one.${bedrockOk ? ' At least one Claude model works, so AI sorting will run.' : ''}`
      : '\nAll good.',
  );
  console.log(
    deployBlocked.length ? 'Deploy: NOT ready (fix the Deploy: lines first).' : 'Deploy: ready.',
  );
  process.exit(
    failed.some((r) => r.check.startsWith('Credentials')) || deployBlocked.length ? 1 : 0,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
