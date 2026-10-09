import type { LatLng } from '@cleanloop/shared';
import type { Logger, RainForecast, WeatherService } from './types';

/** Open-Meteo forecast API: free for non-commercial use, attribution shown in the app. */
export class OpenMeteoWeather implements WeatherService {
  constructor(
    private log: Logger,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  async rainForecast(point: LatLng, date: string): Promise<RainForecast> {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', point.lat.toFixed(4));
    url.searchParams.set('longitude', point.lng.toFixed(4));
    url.searchParams.set('daily', 'precipitation_sum,precipitation_probability_max');
    url.searchParams.set('timezone', 'Asia/Kolkata');
    url.searchParams.set('start_date', date);
    url.searchParams.set('end_date', date);
    try {
      const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as {
        daily?: {
          precipitation_sum?: (number | null)[];
          precipitation_probability_max?: (number | null)[];
        };
      };
      return {
        mm: body.daily?.precipitation_sum?.[0] ?? null,
        probability: body.daily?.precipitation_probability_max?.[0] ?? null,
      };
    } catch (err) {
      this.log.warn('weather forecast unavailable', { date, error: String(err) });
      return { mm: null, probability: null };
    }
  }
}

export class NoWeather implements WeatherService {
  async rainForecast(): Promise<RainForecast> {
    return { mm: null, probability: null };
  }
}
