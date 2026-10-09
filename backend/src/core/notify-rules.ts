import type { NotificationType, Stop } from '@cleanloop/shared';

export interface LaneMessage {
  laneId: string;
  type: NotificationType;
  message: string;
  messageHi: string;
  /** Short text for SMS / email subject. */
  sms: string;
  /** Whether to push it through SNS (SMS/email) or keep it in-app only. */
  push: boolean;
}

function truckNear(stop: Stop, stopsAway: number, minutes: number | undefined): LaneMessage {
  const mins = minutes === undefined ? '' : `, about ${minutes} min`;
  const minsHi = minutes === undefined ? '' : `, लगभग ${minutes} मिनट`;
  const away = stopsAway === 1 ? 'the next stop' : `${stopsAway} stops away`;
  const awayHi = stopsAway === 1 ? 'अगला स्टॉप आपका है' : `${stopsAway} स्टॉप दूर है`;
  return {
    laneId: stop.laneId,
    type: 'truck_near',
    message: `Garbage truck is ${away} from ${stop.laneName}${mins}. Keep wet and dry waste ready in separate bins.`,
    messageHi: `कचरा गाड़ी ${stop.laneName} से ${awayHi}${minsHi}। गीला और सूखा कचरा अलग डिब्बों में तैयार रखें।`,
    sms: `CleanLoop: truck is ${away} from ${stop.laneName}${mins}.`,
    push: true,
  };
}

/**
 * What to tell residents when the driver taps Done or Skip on a stop.
 * - The lane that just became two stops away gets a heads-up.
 * - On the first tap of the day, the very next lane is told as well.
 * - A skipped lane is told it was missed and invited to report.
 */
export function messagesForStopChange(
  before: Stop | undefined,
  after: Stop,
  allStops: Stop[],
  minutesBySeq: Map<number, number>,
): LaneMessage[] {
  if (before && before.status === after.status) return [];
  if (after.status === 'pending') return [];

  const ordered = [...allStops].sort((a, b) => a.seq - b.seq);
  const ahead = ordered.filter((s) => s.status === 'pending' && s.seq > after.seq);
  const firstTap = ordered.filter((s) => s.status !== 'pending').length === 1;
  const out: LaneMessage[] = [];

  if (after.status === 'skipped') {
    const reason = after.skipReason ? ` (${after.skipReason})` : '';
    out.push({
      laneId: after.laneId,
      type: 'missed',
      message: `Your lane ${after.laneName} was missed today${reason}. If a bin is overflowing, report it in CleanLoop.`,
      messageHi: `आज आपकी गली ${after.laneName} छूट गई${reason}। अगर डिब्बा भर गया है तो CleanLoop में रिपोर्ट करें।`,
      sms: `CleanLoop: pickup missed at ${after.laneName} today${reason}. Report an overflowing bin in the app.`,
      push: true,
    });
  } else {
    out.push({
      laneId: after.laneId,
      type: 'collected',
      message: `Waste collected from ${after.laneName}.`,
      messageHi: `${after.laneName} से कचरा उठा लिया गया।`,
      sms: `CleanLoop: waste collected from ${after.laneName}.`,
      push: false,
    });
  }

  if (firstTap && ahead[0]) out.push(truckNear(ahead[0], 1, minutesBySeq.get(ahead[0].seq)));
  if (ahead[1]) out.push(truckNear(ahead[1], 2, minutesBySeq.get(ahead[1].seq)));
  return out;
}
