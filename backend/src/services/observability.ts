import type { Logger, Metrics } from './types';

/**
 * One JSON object per line on stdout. Lambda's console.* adds a text prefix
 * (timestamp, request id, level) that stops CloudWatch from parsing the line as
 * JSON, so log filters like `{ $.level = "error" }` and EMF metrics would not work.
 */
function writeLine(obj: unknown): void {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

export function jsonLogger(base: Record<string, unknown> = {}): Logger {
  const write = (level: string, message: string, data?: Record<string, unknown>) =>
    writeLine({ level, message, time: new Date().toISOString(), ...base, ...data });
  return {
    info: (m, d) => write('info', m, d),
    warn: (m, d) => write('warn', m, d),
    error: (m, d) => write('error', m, d),
  };
}

export const silentLogger: Logger = { info() {}, warn() {}, error() {} };

/**
 * CloudWatch Embedded Metric Format: a structured log line becomes a custom metric,
 * with no PutMetricData calls or extra IAM permissions.
 */
export function emfMetrics(stage: string, namespace = 'CleanLoop'): Metrics {
  return {
    count(name, value = 1) {
      writeLine({
        _aws: {
          Timestamp: Date.now(),
          CloudWatchMetrics: [
            {
              Namespace: namespace,
              Dimensions: [['Stage']],
              Metrics: [{ Name: name, Unit: 'Count' }],
            },
          ],
        },
        Stage: stage,
        [name]: value,
      });
    },
  };
}

export function memoryMetrics(): Metrics & { counts: Record<string, number> } {
  const counts: Record<string, number> = {};
  return {
    counts,
    count(name, value = 1) {
      counts[name] = (counts[name] ?? 0) + value;
    },
  };
}
