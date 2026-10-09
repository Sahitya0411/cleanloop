import { SendEmailCommand, type SESv2Client } from '@aws-sdk/client-sesv2';
import {
  PublishCommand,
  SubscribeCommand,
  UnsubscribeCommand,
  type SNSClient,
} from '@aws-sdk/client-sns';
import type { AlertChannel } from '@cleanloop/shared';
import { buildRawEmail } from './mime';
import type { EmailMessage, LaneAlert, Logger, Notifier } from './types';

export function isReservedDomain(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  return domain.endsWith('.example') || /(^|\.)example\.(com|org|net)$/.test(domain);
}

/**
 * One SNS topic for all lanes; each subscription carries a filter policy on the
 * `laneId` message attribute, so residents only hear about their own lane.
 */
export class AwsNotifier implements Notifier {
  constructor(
    private sns: SNSClient,
    private ses: SESv2Client,
    private topicArn: string,
    private senderEmail: string | undefined,
    private log: Logger,
  ) {}

  async publishLaneAlert(laneId: string, alert: LaneAlert): Promise<void> {
    await this.sns.send(
      new PublishCommand({
        TopicArn: this.topicArn,
        Subject: alert.subject.slice(0, 99),
        MessageStructure: 'json',
        Message: JSON.stringify({ default: alert.email, sms: alert.sms, email: alert.email }),
        MessageAttributes: { laneId: { DataType: 'String', StringValue: laneId } },
      }),
    );
  }

  async subscribe(laneId: string, channel: AlertChannel, endpoint: string) {
    const res = await this.sns.send(
      new SubscribeCommand({
        TopicArn: this.topicArn,
        Protocol: channel,
        Endpoint: endpoint,
        Attributes: { FilterPolicy: JSON.stringify({ laneId: [laneId] }) },
        ReturnSubscriptionArn: true,
      }),
    );
    return { subscriptionArn: res.SubscriptionArn, pendingConfirmation: channel === 'email' };
  }

  async unsubscribe(subscriptionArn: string): Promise<void> {
    try {
      await this.sns.send(new UnsubscribeCommand({ SubscriptionArn: subscriptionArn }));
    } catch (err) {
      // Email subscriptions that were never confirmed cannot be removed; they expire after 3 days.
      this.log.warn('unsubscribe failed', { subscriptionArn, error: String(err) });
    }
  }

  async sendEmail(message: EmailMessage): Promise<boolean> {
    if (!this.senderEmail) {
      this.log.warn('SENDER_EMAIL not set; skipping email', { to: message.to });
      return false;
    }
    if (isReservedDomain(message.to)) {
      // Demo accounts use RFC 2606 addresses; sending there would only bounce.
      this.log.info('skipping email to reserved demo address', { to: message.to });
      return false;
    }
    try {
      await this.ses.send(
        new SendEmailCommand({
          FromEmailAddress: this.senderEmail,
          Destination: { ToAddresses: [message.to] },
          Content: { Raw: { Data: buildRawEmail(this.senderEmail, message) } },
        }),
      );
      return true;
    } catch (err) {
      // In the SES sandbox, unverified recipients are rejected; the app keeps working.
      this.log.warn('email failed', { to: message.to, error: String(err) });
      return false;
    }
  }
}
