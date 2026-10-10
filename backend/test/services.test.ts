import type Anthropic from '@anthropic-ai/sdk';
import { CalculateRoutesCommand, GeoRoutesClient } from '@aws-sdk/client-geo-routes';
import { S3Client } from '@aws-sdk/client-s3';
import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { PublishCommand, SNSClient, SubscribeCommand } from '@aws-sdk/client-sns';
import { mockClient } from 'aws-sdk-client-mock';
import { describe, expect, it, vi } from 'vitest';
import { modelIds } from '../src/handlers/aws-context';
import { parseGroups, userFromClaims } from '../src/handlers/auth';
import { groupFor } from '../src/handlers/post-confirmation';
import { userFromLocalToken } from '../src/local/auth';
import { AwsNotifier, isReservedDomain } from '../src/services/aws-notifier';
import { BedrockAi, usesInvokeModel, type MessagesClient } from '../src/services/bedrock-ai';
import { FallbackAi } from '../src/services/fallback-ai';
import { AmazonLocationPlanner, EstimatePlanner } from '../src/services/location-planner';
import { buildRawEmail } from '../src/services/mime';
import { MockAi } from '../src/services/mock-ai';
import { silentLogger } from '../src/services/observability';
import { OpenMeteoWeather } from '../src/services/open-meteo';
import { S3Storage } from '../src/services/s3-storage';
import type { ImageInput } from '../src/services/types';

const image: ImageInput = { bytes: new Uint8Array([1, 2, 3]), mediaType: 'image/jpeg', key: 'k' };

function message(
  content: Anthropic.ContentBlock[],
  stop: Anthropic.StopReason = 'tool_use',
): Anthropic.Message {
  return {
    id: 'm',
    type: 'message',
    role: 'assistant',
    model: 'x',
    content,
    stop_reason: stop,
    stop_sequence: null,
    usage: {} as Anthropic.Usage,
  } as unknown as Anthropic.Message;
}

const toolUse = (name: string, input: unknown) =>
  ({ type: 'tool_use', id: 't', name, input }) as unknown as Anthropic.ContentBlock;

describe('BedrockAi', () => {
  const sortInput = {
    isWasteItem: true,
    itemName: 'Plastic bottle',
    category: 'dry',
    material: 'plastic',
    tip: 'Rinse it',
    confidence: 0.91,
  };

  it('sends the image with the tool and reads the tool call', async () => {
    const create = vi.fn().mockResolvedValue(message([toolUse('record_sort', sortInput)]));
    const ai = new BedrockAi(
      { messages: { create } } as MessagesClient,
      ['anthropic.claude-opus-5-5'],
      silentLogger,
    );
    const out = await ai.classify(image, { lang: 'en' });
    expect(out).toMatchObject({ category: 'dry', material: 'plastic', source: 'bedrock' });
    const params = create.mock.calls[0]![0] as Anthropic.MessageCreateParamsNonStreaming;
    expect(params.model).toBe('anthropic.claude-opus-5-5');
    expect(params.tools?.[0]).toMatchObject({ name: 'record_sort' });
    expect(params.tool_choice).toEqual({ type: 'auto' });
    expect(params.output_config).toEqual({ effort: 'low' });
    expect(create.mock.calls[0]![1]).toEqual({ timeout: 12_000, maxRetries: 0 });
    expect(params).not.toHaveProperty('thinking');
    const content = params.messages[0]!.content as Anthropic.ContentBlockParam[];
    expect(content[0]).toMatchObject({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: 'AQID' },
    });
  });

  it('falls through to the next model on refusal or invalid output, and skips effort on Haiku 4.5', async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce(message([], 'refusal'))
      .mockResolvedValueOnce(message([toolUse('record_sort', { category: 'nonsense' })]))
      .mockResolvedValueOnce(
        message(
          [{ type: 'text', text: JSON.stringify(sortInput) } as Anthropic.ContentBlock],
          'end_turn',
        ),
      );
    const ai = new BedrockAi(
      { messages: { create } } as MessagesClient,
      ['m1', 'm2', 'anthropic.claude-haiku-4-5'],
      silentLogger,
    );
    const out = await ai.classify(image, { lang: 'hi' });
    expect(out.itemName).toBe('Plastic bottle');
    expect(create).toHaveBeenCalledTimes(3);
    expect(create.mock.calls[2]![0]).not.toHaveProperty('output_config');
    expect((create.mock.calls[0]![0] as { system: string }).system).toContain('Hindi');
  });

  it('stops trying models when the time budget is spent', async () => {
    const create = vi
      .fn()
      .mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(message([], 'refusal')), 30)),
      );
    const ai = new BedrockAi(
      { messages: { create } } as MessagesClient,
      ['m1', 'm2', 'm3'],
      silentLogger,
      {
        totalMs: 2_520,
        perCallMs: 2_000,
      },
    );
    await expect(ai.classify(image, { lang: 'en' })).rejects.toThrow('declined');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('routes inference-profile and versioned ids to InvokeModel, without effort', async () => {
    expect(usesInvokeModel('anthropic.claude-opus-5-5')).toBe(false);
    expect(usesInvokeModel('global.anthropic.claude-sonnet-4-6')).toBe(true);
    expect(usesInvokeModel('apac.anthropic.claude-3-5-sonnet-20241022-v2:0')).toBe(true);
    expect(usesInvokeModel('anthropic.claude-opus-4-6-v1')).toBe(true);
    const mantle = { create: vi.fn().mockRejectedValue(new Error('404 not found')) };
    const invoke = {
      create: vi.fn().mockResolvedValue(message([toolUse('record_sort', sortInput)])),
    };
    const ai = new BedrockAi(
      (model) => ({ messages: usesInvokeModel(model) ? invoke : mantle }) as MessagesClient,
      ['anthropic.claude-opus-5-5', 'global.anthropic.claude-sonnet-4-6'],
      silentLogger,
    );
    expect((await ai.classify(image, { lang: 'en' })).category).toBe('dry');
    expect(mantle.create).toHaveBeenCalledTimes(1);
    expect(invoke.create.mock.calls[0]![0]).not.toHaveProperty('output_config');
  });

  it('throws when every model fails', async () => {
    const create = vi.fn().mockRejectedValue(new Error('AccessDenied'));
    const ai = new BedrockAi({ messages: { create } } as MessagesClient, ['m1'], silentLogger);
    await expect(ai.assessSeverity(image, { lang: 'en' })).rejects.toThrow('AccessDenied');
  });

  it('reads model ids from the environment, de-duplicated', () => {
    expect(modelIds({})).toEqual([
      'anthropic.claude-opus-5-5',
      'anthropic.claude-haiku-4-5',
      'global.anthropic.claude-sonnet-4-6',
    ]);
    expect(modelIds({ BEDROCK_MODEL_ID: 'a', BEDROCK_FALLBACK_MODEL_IDS: 'b, a,,c' })).toEqual([
      'a',
      'b',
      'c',
    ]);
  });
});

describe('FallbackAi', () => {
  it('uses the second provider when the first fails', async () => {
    const broken = {
      classify: vi.fn().mockRejectedValue(new Error('down')),
      assessSeverity: vi.fn(),
    };
    const ai = new FallbackAi(
      [
        { name: 'a', ai: broken },
        { name: 'b', ai: new MockAi() },
      ],
      silentLogger,
    );
    expect((await ai.classify(image, { lang: 'en', hint: 'banana.jpg' })).category).toBe('wet');
  });
});

describe('email MIME', () => {
  it('encodes non-ASCII subjects and inlines images by Content-ID', () => {
    const raw = Buffer.from(
      buildRawEmail('CleanLoop <noreply@example.com>', {
        to: 'officer@example.com',
        subject: 'गली रिपोर्ट',
        text: 'hello',
        html: '<img src="cid:p">',
        attachments: [
          {
            filename: 'p.jpg',
            contentType: 'image/jpeg',
            bytes: new Uint8Array([255, 216]),
            contentId: 'p',
          },
        ],
      }),
    ).toString('utf8');
    expect(raw).toContain('Subject: =?UTF-8?B?');
    expect(raw).toContain('Content-ID: <p>');
    expect(raw).toContain('multipart/related');
    expect(raw).toContain('Content-Disposition: inline; filename="p.jpg"');
  });
});

describe('AwsNotifier', () => {
  const sns = mockClient(SNSClient);
  const ses = mockClient(SESv2Client);

  it('publishes lane alerts with a laneId attribute and per-protocol text', async () => {
    sns.reset();
    sns.on(PublishCommand).resolves({});
    const n = new AwsNotifier(
      new SNSClient({}),
      new SESv2Client({}),
      'arn:topic',
      'a@b.c',
      silentLogger,
    );
    await n.publishLaneAlert('lane-1', { subject: 'S', sms: 'short', email: 'long' });
    const input = sns.commandCalls(PublishCommand)[0]!.args[0].input;
    expect(input.MessageAttributes?.laneId?.StringValue).toBe('lane-1');
    expect(JSON.parse(input.Message!)).toEqual({ default: 'long', sms: 'short', email: 'long' });
  });

  it('subscribes with a lane filter policy', async () => {
    sns.reset();
    sns.on(SubscribeCommand).resolves({ SubscriptionArn: 'arn:sub' });
    const n = new AwsNotifier(
      new SNSClient({}),
      new SESv2Client({}),
      'arn:topic',
      'a@b.c',
      silentLogger,
    );
    const res = await n.subscribe('lane-1', 'email', 'x@y.z');
    expect(res).toEqual({ subscriptionArn: 'arn:sub', pendingConfirmation: true });
    const input = sns.commandCalls(SubscribeCommand)[0]!.args[0].input;
    expect(JSON.parse(input.Attributes!.FilterPolicy!)).toEqual({ laneId: ['lane-1'] });
  });

  it('never emails reserved demo domains', async () => {
    expect(isReservedDomain('resident@cleanloop.example')).toBe(true);
    expect(isReservedDomain('a@example.com')).toBe(true);
    expect(isReservedDomain('heer@gmail.com')).toBe(false);
    ses.reset();
    ses.on(SendEmailCommand).resolves({});
    const n = new AwsNotifier(
      new SNSClient({}),
      new SESv2Client({}),
      'arn:topic',
      'a@b.c',
      silentLogger,
    );
    expect(
      await n.sendEmail({ to: 'officer@cleanloop.example', subject: 's', text: 't', html: 'h' }),
    ).toBe(false);
    expect(ses.commandCalls(SendEmailCommand)).toHaveLength(0);
  });

  it('reports email failures without throwing', async () => {
    ses.reset();
    ses.on(SendEmailCommand).rejects(new Error('MessageRejected: Email address is not verified'));
    const n = new AwsNotifier(
      new SNSClient({}),
      new SESv2Client({}),
      'arn:topic',
      'a@b.c',
      silentLogger,
    );
    expect(await n.sendEmail({ to: 'x@y.z', subject: 's', text: 't', html: 'h' })).toBe(false);
    const noSender = new AwsNotifier(
      new SNSClient({}),
      new SESv2Client({}),
      'arn:topic',
      undefined,
      silentLogger,
    );
    expect(await noSender.sendEmail({ to: 'x@y.z', subject: 's', text: 't', html: 'h' })).toBe(
      false,
    );
  });
});

describe('S3Storage', () => {
  it('presigns a POST that pins the key and content type', async () => {
    const storage = new S3Storage(
      new S3Client({
        region: 'ap-south-1',
        credentials: { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret' },
      }),
      'photos-bucket',
    );
    const ticket = await storage.uploadTicket('uploads/sort/u1/img.jpg', 'image/jpeg');
    expect(ticket.url).toContain('photos-bucket');
    expect(ticket.fields.key).toBe('uploads/sort/u1/img.jpg');
    expect(ticket.fields['Content-Type']).toBe('image/jpeg');
    const policy = JSON.parse(Buffer.from(ticket.fields.Policy!, 'base64').toString('utf8'));
    expect(policy.conditions).toContainEqual(['content-length-range', 1, 8 * 1024 * 1024]);
  });
});

describe('route planners', () => {
  const points = [
    { lat: 28.75, lng: 77.11 },
    { lat: 28.74, lng: 77.12 },
    { lat: 28.75, lng: 77.11 },
  ];

  it('estimates road distance from straight lines', async () => {
    const m = await new EstimatePlanner().measure(points);
    expect(m.legKm).toHaveLength(2);
    expect(m.km).toBeGreaterThan(2.5);
    expect(m.method).toBe('estimate');
  });

  it('uses Amazon Location truck routing and keeps the road geometry', async () => {
    const geo = mockClient(GeoRoutesClient);
    const leg = (m: number, s: number) => ({
      Geometry: {
        LineString: [
          [77.11, 28.75],
          [77.12, 28.74],
        ],
      },
      VehicleLegDetails: { Summary: { Overview: { Distance: m, Duration: s } } },
    });
    geo
      .on(CalculateRoutesCommand)
      .resolves({ Routes: [{ Legs: [leg(1500, 300), leg(1700, 360)] }] } as never);
    const m = await new AmazonLocationPlanner(new GeoRoutesClient({}), silentLogger).measure(
      points,
    );
    expect(m.method).toBe('amazon-location');
    expect(m.km).toBeCloseTo(3.2);
    expect(m.legDriveMinutes).toEqual([5, 6]);
    expect(m.path?.length).toBe(4);
    const input = geo.commandCalls(CalculateRoutesCommand)[0]!.args[0].input;
    expect(input.TravelMode).toBe('Truck');
    expect(input.Origin).toEqual([77.11, 28.75]);
  });

  it('falls back to the estimate when Amazon Location fails', async () => {
    const geo = mockClient(GeoRoutesClient);
    geo.on(CalculateRoutesCommand).rejects(new Error('AccessDenied'));
    const m = await new AmazonLocationPlanner(new GeoRoutesClient({}), silentLogger).measure(
      points,
    );
    expect(m.method).toBe('estimate');
  });
});

describe('Open-Meteo', () => {
  it('reads the daily rain forecast', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          daily: { precipitation_sum: [6.2], precipitation_probability_max: [70] },
        }),
      ),
    );
    const w = new OpenMeteoWeather(silentLogger, fetchImpl as unknown as typeof fetch);
    expect(await w.rainForecast({ lat: 28.7, lng: 77.1 }, '2026-10-10')).toEqual({
      mm: 6.2,
      probability: 70,
    });
    expect(String(fetchImpl.mock.calls[0]![0])).toContain('timezone=Asia%2FKolkata');
  });

  it('returns nulls when the API is unreachable', async () => {
    const w = new OpenMeteoWeather(
      silentLogger,
      vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch,
    );
    expect(await w.rainForecast({ lat: 28.7, lng: 77.1 }, '2026-10-10')).toEqual({
      mm: null,
      probability: null,
    });
  });
});

describe('auth', () => {
  it('parses Cognito group claims in every shape API Gateway sends', () => {
    expect(parseGroups('[officer resident]')).toEqual(['officer', 'resident']);
    expect(parseGroups('[driver, resident]')).toEqual(['driver', 'resident']);
    expect(parseGroups(['recycler'])).toEqual(['recycler']);
    expect(parseGroups(undefined)).toEqual([]);
  });

  it('picks the most privileged role and defaults to resident', () => {
    expect(
      userFromClaims({ sub: 'u1', 'cognito:groups': '[resident officer]', email: 'a@b.c' }),
    ).toMatchObject({ userId: 'u1', role: 'officer', email: 'a@b.c' });
    expect(userFromClaims({ sub: 'u2' })?.role).toBe('resident');
    expect(userFromClaims(undefined)).toBeUndefined();
  });

  it('only lets people sign themselves up as residents or recyclers', () => {
    expect(groupFor('recycler')).toBe('recycler');
    expect(groupFor('officer')).toBe('resident');
    expect(groupFor(undefined)).toBe('resident');
  });

  it('accepts local demo tokens only with a valid role', () => {
    const token = (claims: object) =>
      `Bearer local.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`;
    expect(userFromLocalToken(token({ sub: 'u', role: 'driver' }))?.role).toBe('driver');
    expect(userFromLocalToken(token({ sub: 'u', role: 'admin' }))).toBeUndefined();
    expect(userFromLocalToken('Bearer eyJhbGciOi')).toBeUndefined();
  });
});

describe('observability', () => {
  it('writes logs and EMF metrics as bare JSON lines', async () => {
    const { emfMetrics, jsonLogger } = await import('../src/services/observability');
    const out: string[] = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      out.push(String(chunk));
      return true;
    });
    jsonLogger({ stage: 't' }).error('boom', { code: 1 });
    emfMetrics('dev').count('ItemsSorted');
    spy.mockRestore();
    const [log, metric] = out.map((l) => JSON.parse(l));
    expect(log).toMatchObject({ level: 'error', message: 'boom', stage: 't', code: 1 });
    expect(metric._aws.CloudWatchMetrics[0]).toMatchObject({
      Namespace: 'CleanLoop',
      Dimensions: [['Stage']],
    });
    expect(metric).toMatchObject({ Stage: 'dev', ItemsSorted: 1 });
  });
});
