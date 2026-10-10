// Seeds a deployed stack: demo Cognito users for every role, the DTU demo ward with
// four weeks of history, and today's and tomorrow's plans (with Amazon Location).
//
//   npm run seed -- --stack cleanloop-dev [--reseed]
//
// Writes the demo credentials to .deploy/demo-users.json (git-ignored).

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Role } from '@cleanloop/shared';
import { istDate } from '@cleanloop/shared';
import { buildSeed, writeSeed, WARD_ID, type DemoUserIds } from './seed-data';
import { arg, ensureUser, flag, generatePassword, scriptContext, stackOutputs } from './cli';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const CREDS = path.join(ROOT, '.deploy', 'demo-users.json');

const DEMO_USERS: Record<Role, { email: string; name: string }> = {
  resident: { email: 'resident@cleanloop.example', name: 'Heer' },
  driver: { email: 'driver@cleanloop.example', name: 'Ramesh Kumar' },
  officer: { email: 'officer@cleanloop.example', name: 'Ward Officer' },
  recycler: { email: 'recycler@cleanloop.example', name: 'Sunil Kabadiwala' },
};

interface SavedCreds {
  password: string;
  emails: Record<Role, string>;
  ids: DemoUserIds;
}

async function savedCreds(): Promise<SavedCreds | undefined> {
  try {
    return JSON.parse(await readFile(CREDS, 'utf8')) as SavedCreds;
  } catch {
    return undefined;
  }
}

async function main() {
  const stack = arg('stack') ?? process.env.STACK_NAME ?? 'cleanloop-dev';
  const out = await stackOutputs(stack);
  const ctx = scriptContext(out, process.env.SENDER_EMAIL);
  const today = istDate();
  console.log(`Seeding ${stack} in ${out.Region} for ${today}`);

  // 1. Demo accounts (one per role). The password is reused across runs.
  const previous = await savedCreds();
  const password = previous?.password ?? generatePassword();
  const ids = {} as DemoUserIds;
  for (const role of Object.keys(DEMO_USERS) as Role[]) {
    ids[role] = await ensureUser(out.UserPoolId, { ...DEMO_USERS[role], role, password });
    console.log(`  user ${role.padEnd(9)} ${DEMO_USERS[role].email}`);
  }
  await mkdir(path.dirname(CREDS), { recursive: true });
  const creds: SavedCreds = {
    password,
    emails: Object.fromEntries(Object.entries(DEMO_USERS).map(([r, u]) => [r, u.email])) as Record<
      Role,
      string
    >,
    ids,
  };
  await writeFile(CREDS, JSON.stringify(creds, null, 2));

  // 2. Ward data. Skipped if already present, unless --reseed.
  const existing = await ctx.repo.getWard(WARD_ID);
  if (existing && !flag('reseed')) {
    console.log(
      '  ward already seeded (use --reseed to rebuild); refreshing the officer email and plans only',
    );
    await ctx.repo.batchPut([
      ctx.repo.wardItem({ ...existing, officerEmail: out.OfficerEmail || undefined }),
    ]);
    const route = (await ctx.repo.listRoutes(WARD_ID))[0];
    if (route && route.driverId !== ids.driver) {
      await ctx.repo.batchPut([ctx.repo.routeItem({ ...route, driverId: ids.driver })]);
    }
  } else {
    const data = buildSeed({
      today,
      ids,
      officerEmail: out.OfficerEmail || undefined,
      emails: creds.emails,
    });
    await writeSeed(ctx, data, today);
    console.log(
      `  wrote 1 ward, ${data.lanes.length} lanes, ${data.stops.length} historic stops, ${data.reports.length} reports, ${data.pickups.length} pickups`,
    );
  }

  const runs = await ctx.repo.listWardRuns(WARD_ID, today, today);
  for (const run of runs) {
    console.log(
      `  today's plan: ${run.order.length} stops, ${run.deferred.length} deferred, ${run.savings.kmSaved} km saved (${run.savings.method})`,
    );
  }
  console.log(`Demo credentials saved to ${path.relative(ROOT, CREDS)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
