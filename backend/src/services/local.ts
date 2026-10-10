import type { AlertChannel, UploadTicket } from '@cleanloop/shared';
import { MAX_UPLOAD_BYTES } from './s3-storage';
import type { EmailMessage, LaneAlert, Logger, Notifier, Storage } from './types';

/** Keeps uploads in memory and serves them from the local dev server. */
export class LocalStorage implements Storage {
  readonly files = new Map<string, { bytes: Uint8Array; contentType: string }>();

  constructor(private baseUrl: string) {}

  async uploadTicket(key: string, contentType: string): Promise<UploadTicket> {
    return {
      key,
      url: `${this.baseUrl}/local-upload`,
      fields: { key, 'Content-Type': contentType },
      maxBytes: MAX_UPLOAD_BYTES,
    };
  }

  async read(key: string) {
    const file = this.files.get(key);
    if (!file) throw new Error(`No such object: ${key}`);
    return file;
  }

  async viewUrl(key: string): Promise<string> {
    return `${this.baseUrl}/local-files/${encodeURIComponent(key)}`;
  }

  async write(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    this.files.set(key, { bytes, contentType });
  }
}

export type OutboxEntry =
  | { kind: 'lane_alert'; laneId: string; alert: LaneAlert; at: string }
  | { kind: 'email'; message: Omit<EmailMessage, 'attachments'>; attachments: number; at: string }
  | { kind: 'subscribe'; laneId: string; channel: AlertChannel; endpoint: string; at: string };

/** Records what would have gone to SNS/SES so it can be inspected at /local/outbox. */
export class LocalNotifier implements Notifier {
  readonly outbox: OutboxEntry[] = [];

  constructor(private log: Logger) {}

  async publishLaneAlert(laneId: string, alert: LaneAlert): Promise<void> {
    this.outbox.push({ kind: 'lane_alert', laneId, alert, at: new Date().toISOString() });
    this.log.info('[sns] lane alert', { laneId, sms: alert.sms });
  }

  async subscribe(laneId: string, channel: AlertChannel, endpoint: string) {
    this.outbox.push({
      kind: 'subscribe',
      laneId,
      channel,
      endpoint,
      at: new Date().toISOString(),
    });
    return {
      subscriptionArn: `local:${laneId}:${channel}:${endpoint}`,
      pendingConfirmation: channel === 'email',
    };
  }

  async unsubscribe(): Promise<void> {}

  async sendEmail(message: EmailMessage): Promise<boolean> {
    const { attachments, ...rest } = message;
    this.outbox.push({
      kind: 'email',
      message: rest,
      attachments: attachments?.length ?? 0,
      at: new Date().toISOString(),
    });
    this.log.info('[ses] email', { to: message.to, subject: message.subject });
    return true;
  }
}
