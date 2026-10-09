import { randomUUID } from 'node:crypto';
import type { EmailMessage } from './types';

const CRLF = '\r\n';

function base64Lines(bytes: Uint8Array | string): string {
  const b64 = Buffer.from(bytes).toString('base64');
  return b64.match(/.{1,76}/g)?.join(CRLF) ?? '';
}

/** RFC 2047 encoded-word, so Hindi lane names survive in the subject line. */
function encodeHeader(value: string): string {
  return /^[\x20-\x7e]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

/** Builds a raw MIME message (text + HTML, inline images) for SES SendEmail. */
export function buildRawEmail(from: string, msg: EmailMessage): Uint8Array {
  const related = `rel_${randomUUID()}`;
  const alt = `alt_${randomUUID()}`;
  const lines: string[] = [
    `From: ${from}`,
    `To: ${msg.to}`,
    `Subject: ${encodeHeader(msg.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/related; boundary="${related}"`,
    '',
    `--${related}`,
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    '',
    `--${alt}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(msg.text),
    `--${alt}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(msg.html),
    `--${alt}--`,
  ];
  for (const a of msg.attachments ?? []) {
    lines.push(
      `--${related}`,
      `Content-Type: ${a.contentType}; name="${a.filename}"`,
      'Content-Transfer-Encoding: base64',
      ...(a.contentId ? [`Content-ID: <${a.contentId}>`] : []),
      `Content-Disposition: ${a.contentId ? 'inline' : 'attachment'}; filename="${a.filename}"`,
      '',
      base64Lines(a.bytes),
    );
  }
  lines.push(`--${related}--`, '');
  return Buffer.from(lines.join(CRLF), 'utf8');
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
