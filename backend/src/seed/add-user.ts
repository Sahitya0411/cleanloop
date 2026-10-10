// Creates a real staff account (drivers and ward officers cannot self-register).
//
//   npm run add-user -- --stack cleanloop-dev --email ravi@example.org --name "Ravi" --role driver [--assign-route]
//
// Prints a one-time password; the person signs in with it and can reset it via
// "Forgot password?" in the app.

import { ROLES, type Role } from '@cleanloop/shared';
import { WARD_ID } from './seed-data';
import { arg, ensureUser, flag, generatePassword, scriptContext, stackOutputs } from './cli';

async function main() {
  const stack = arg('stack') ?? process.env.STACK_NAME ?? 'cleanloop-dev';
  const email = arg('email');
  const name = arg('name');
  const role = arg('role') as Role | undefined;
  if (!email || !name || !role || !ROLES.includes(role)) {
    console.error(
      'Usage: npm run add-user -- --email <email> --name <name> --role <resident|driver|officer|recycler> [--assign-route]',
    );
    process.exit(2);
  }
  const out = await stackOutputs(stack);
  const password = generatePassword();
  const sub = await ensureUser(out.UserPoolId, { email, name, role, password });
  console.log(`Created ${role} ${email} (sub ${sub})`);
  console.log(`Temporary password: ${password}`);

  if (role === 'driver' && flag('assign-route')) {
    const ctx = scriptContext(out);
    const route = (await ctx.repo.listRoutes(WARD_ID))[0];
    if (!route) throw new Error('No route found; run npm run seed first');
    await ctx.repo.batchPut([ctx.repo.routeItem({ ...route, driverId: sub })]);
    console.log(`Assigned ${route.name} to ${name}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
