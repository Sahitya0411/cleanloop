import type { LatLng } from '@cleanloop/shared';

export interface WeatherNow {
  tempC: number;
  code: number;
  pm25: number | null;
}

export type AirBand = 'good' | 'satisfactory' | 'moderate' | 'poor' | 'veryPoor' | 'severe';

/** India's National AQI bands for PM2.5 (µg/m³), the pollutant that drives Delhi's AQI. */
export function airBand(pm25: number): AirBand {
  if (pm25 <= 30) return 'good';
  if (pm25 <= 60) return 'satisfactory';
  if (pm25 <= 90) return 'moderate';
  if (pm25 <= 120) return 'poor';
  if (pm25 <= 250) return 'veryPoor';
  return 'severe';
}

export function weatherKind(code: number): 'clear' | 'cloudy' | 'fog' | 'rain' | 'storm' {
  if (code <= 1) return 'clear';
  if (code <= 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 95) return 'storm';
  return 'rain';
}

/** Open-Meteo forecast + air-quality APIs (free, no key; attribution shown in the UI). */
export async function fetchWeather(p: LatLng): Promise<WeatherNow | null> {
  const lat = p.lat.toFixed(3);
  const lng = p.lng.toFixed(3);
  try {
    const [wx, air] = await Promise.all([
      fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weather_code&timezone=Asia%2FKolkata`,
      ).then((r) => r.json()),
      fetch(
        `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lng}&current=pm2_5&timezone=Asia%2FKolkata`,
      )
        .then((r) => r.json())
        .catch(() => null),
    ]);
    if (typeof wx?.current?.temperature_2m !== 'number') return null;
    return {
      tempC: Math.round(wx.current.temperature_2m),
      code: wx.current.weather_code ?? 0,
      pm25: typeof air?.current?.pm2_5 === 'number' ? Math.round(air.current.pm2_5) : null,
    };
  } catch {
    return null;
  }
}
