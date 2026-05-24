/**
 * Weather tool backed by free APIs (no API key required):
 *
 * - Zippopotam.us for US ZIP → place + lat/lon geocoding.
 * - Open-Meteo for current conditions + daily forecast.
 *
 * Kept deliberately small: input is a US ZIP (or the user's Config default),
 * output is a single JSON blob with current + next few days so the model can
 * phrase whatever the user asked for ("is it raining", "what's the high",
 * "do I need a jacket", etc.) without needing a second call.
 */

const ZIPPOPOTAM_URL = "https://api.zippopotam.us/us";
const OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const FETCH_TIMEOUT_MS = 15_000;

export interface WeatherLocation {
  zip: string;
  place: string;
  state: string;
  lat: number;
  lon: number;
}

export interface WeatherCurrent {
  time: string;
  temp_f: number;
  apparent_f: number;
  humidity_pct: number;
  wind_mph: number;
  wind_gusts_mph: number;
  precipitation_in: number;
  weather: string;
  is_day: boolean;
}

export interface WeatherDaily {
  date: string;
  weather: string;
  high_f: number;
  low_f: number;
  precip_chance_pct: number;
  precip_sum_in: number;
  sunrise: string;
  sunset: string;
}

export interface WeatherResultPayload {
  units: "imperial";
  location: WeatherLocation;
  current: WeatherCurrent;
  daily: WeatherDaily[];
  error?: string;
}

export interface WeatherErrorPayload {
  error: string;
  zip?: string;
}

function normalizeZip(raw: string): string | null {
  const digits = raw.replace(/\D+/g, "");
  if (digits.length < 5) return null;
  return digits.slice(0, 5);
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  }
  return res.json();
}

async function geocodeZip(zip: string): Promise<WeatherLocation> {
  const data = (await fetchJson(`${ZIPPOPOTAM_URL}/${zip}`)) as {
    "post code"?: string;
    places?: Array<{
      "place name"?: string;
      latitude?: string;
      longitude?: string;
      "state abbreviation"?: string;
      state?: string;
    }>;
  };

  const place = data.places?.[0];
  const lat = place?.latitude ? Number.parseFloat(place.latitude) : NaN;
  const lon = place?.longitude ? Number.parseFloat(place.longitude) : NaN;
  if (!place || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error(`Could not resolve ZIP ${zip}`);
  }
  return {
    zip: data["post code"] ?? zip,
    place: place["place name"] ?? "",
    state: place["state abbreviation"] ?? place.state ?? "",
    lat,
    lon,
  };
}

// https://open-meteo.com/en/docs — WMO weather interpretation codes.
const WEATHER_CODE_LABELS: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Heavy drizzle",
  56: "Light freezing drizzle",
  57: "Freezing drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  66: "Light freezing rain",
  67: "Freezing rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Rain showers",
  81: "Heavy rain showers",
  82: "Violent rain showers",
  85: "Snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with hail",
  99: "Thunderstorm with heavy hail",
};

function describeWeatherCode(code: unknown): string {
  if (typeof code !== "number") return "Unknown";
  return WEATHER_CODE_LABELS[code] ?? `Weather code ${code}`;
}

interface OpenMeteoResponse {
  current?: {
    time?: string;
    temperature_2m?: number;
    apparent_temperature?: number;
    relative_humidity_2m?: number;
    wind_speed_10m?: number;
    wind_gusts_10m?: number;
    precipitation?: number;
    weather_code?: number;
    is_day?: number;
  };
  daily?: {
    time?: string[];
    weather_code?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_probability_max?: number[];
    precipitation_sum?: number[];
    sunrise?: string[];
    sunset?: string[];
  };
}

async function fetchForecast(
  location: WeatherLocation,
  days: number
): Promise<{ current: WeatherCurrent; daily: WeatherDaily[] }> {
  const params = new URLSearchParams({
    latitude: String(location.lat),
    longitude: String(location.lon),
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    precipitation_unit: "inch",
    timezone: "auto",
    current: [
      "temperature_2m",
      "apparent_temperature",
      "relative_humidity_2m",
      "wind_speed_10m",
      "wind_gusts_10m",
      "precipitation",
      "weather_code",
      "is_day",
    ].join(","),
    daily: [
      "weather_code",
      "temperature_2m_max",
      "temperature_2m_min",
      "precipitation_probability_max",
      "precipitation_sum",
      "sunrise",
      "sunset",
    ].join(","),
    forecast_days: String(Math.min(7, Math.max(1, days))),
  });

  const data = (await fetchJson(`${OPEN_METEO_FORECAST_URL}?${params.toString()}`)) as OpenMeteoResponse;

  const c = data.current ?? {};
  const current: WeatherCurrent = {
    time: c.time ?? "",
    temp_f: c.temperature_2m ?? Number.NaN,
    apparent_f: c.apparent_temperature ?? Number.NaN,
    humidity_pct: c.relative_humidity_2m ?? Number.NaN,
    wind_mph: c.wind_speed_10m ?? Number.NaN,
    wind_gusts_mph: c.wind_gusts_10m ?? Number.NaN,
    precipitation_in: c.precipitation ?? 0,
    weather: describeWeatherCode(c.weather_code),
    is_day: c.is_day === 1,
  };

  const d = data.daily ?? {};
  const times = d.time ?? [];
  const daily: WeatherDaily[] = times.map((date, i) => ({
    date,
    weather: describeWeatherCode(d.weather_code?.[i]),
    high_f: d.temperature_2m_max?.[i] ?? Number.NaN,
    low_f: d.temperature_2m_min?.[i] ?? Number.NaN,
    precip_chance_pct: d.precipitation_probability_max?.[i] ?? 0,
    precip_sum_in: d.precipitation_sum?.[i] ?? 0,
    sunrise: d.sunrise?.[i] ?? "",
    sunset: d.sunset?.[i] ?? "",
  }));

  return { current, daily };
}

export async function getWeatherForZip(
  zip: string,
  days: number
): Promise<WeatherResultPayload | WeatherErrorPayload> {
  const normalized = normalizeZip(zip);
  if (!normalized) {
    return { error: "Invalid ZIP code (expected 5 US digits)", zip };
  }
  try {
    const location = await geocodeZip(normalized);
    const { current, daily } = await fetchForecast(location, days);
    return { units: "imperial", location, current, daily };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : String(err),
      zip: normalized,
    };
  }
}
