import { addDays, istDate, round } from '@cleanloop/shared';
import { planWard } from '../domain/planning';
import { awsContext } from './aws-context';

/** EventBridge Scheduler, every night at 22:00 IST: plan tomorrow for every ward. */
export async function handler(): Promise<{ date: string; wards: number; kmSaved: number }> {
  const ctx = awsContext();
  const date = addDays(istDate(ctx.now()), 1);
  let kmSaved = 0;
  const wards = await ctx.repo.listWards();
  for (const ward of wards) {
    const result = await planWard(ctx, ward.wardId, date, 'nightly');
    kmSaved += result.runs.reduce((s, r) => s + r.savings.kmSaved, 0);
  }
  const summary = { date, wards: wards.length, kmSaved: round(kmSaved, 1) };
  ctx.log.info('nightly plan complete', summary);
  return summary;
}
