//! Ambient current weather for the desktop compose splash (US ZIP → Open-Meteo).

use std::time::Duration;

use reqwest::Client;
use serde::Serialize;
use serde_json::{json, Value};

use crate::settings;
use crate::storage::WriteChains;

const ZIPPOPOTAM_URL: &str = "https://api.zippopotam.us/us";
const OPEN_METEO_FORECAST_URL: &str = "https://api.open-meteo.com/v1/forecast";
const DEFAULT_ZIP: &str = "12528";

#[derive(Debug, Clone)]
struct WeatherLocation {
    zip: String,
    place: String,
    state: String,
    lat: f64,
    lon: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrentWeather {
    pub temp_f: f64,
    pub place: String,
    pub state: String,
    pub zip: String,
    pub weather: String,
    /// Quiet compose-corner label, e.g. `72° · Highland`.
    pub label: String,
}

pub fn normalize_zip(raw: &str) -> Option<String> {
    let digits: String = raw.chars().filter(|c| c.is_ascii_digit()).collect();
    if digits.len() < 5 {
        return None;
    }
    Some(digits.chars().take(5).collect())
}

fn describe_weather_code(code: i64) -> String {
    match code {
        0 => "Clear sky".into(),
        1 => "Mainly clear".into(),
        2 => "Partly cloudy".into(),
        3 => "Overcast".into(),
        45 | 48 => "Fog".into(),
        51 | 53 | 55 | 56 | 57 => "Drizzle".into(),
        61 | 63 | 65 | 66 | 67 | 80 | 81 | 82 => "Rain".into(),
        71 | 73 | 75 | 77 | 85 | 86 => "Snow".into(),
        95 | 96 | 99 => "Thunderstorm".into(),
        other => format!("Weather code {other}"),
    }
}

async fn fetch_json(client: &Client, url: &str) -> Result<Value, String> {
    let response = client
        .get(url)
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "HTTP {} {}",
            response.status(),
            response.status().canonical_reason().unwrap_or("error")
        ));
    }
    response.json().await.map_err(|e| e.to_string())
}

async fn geocode_zip(client: &Client, zip: &str) -> Result<WeatherLocation, String> {
    let data = fetch_json(client, &format!("{ZIPPOPOTAM_URL}/{zip}")).await?;
    let place = data
        .get("places")
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.first())
        .ok_or_else(|| format!("Could not resolve ZIP {zip}"))?;
    let lat = place
        .get("latitude")
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse::<f64>().ok())
        .ok_or_else(|| format!("Could not resolve ZIP {zip}"))?;
    let lon = place
        .get("longitude")
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse::<f64>().ok())
        .ok_or_else(|| format!("Could not resolve ZIP {zip}"))?;
    Ok(WeatherLocation {
        zip: data
            .get("post code")
            .and_then(|v| v.as_str())
            .unwrap_or(zip)
            .to_string(),
        place: place
            .get("place name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        state: place
            .get("state abbreviation")
            .or_else(|| place.get("state"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        lat,
        lon,
    })
}

async fn fetch_current_temp(
    client: &Client,
    location: &WeatherLocation,
) -> Result<(f64, String), String> {
    let url = format!(
        "{OPEN_METEO_FORECAST_URL}?latitude={}&longitude={}&temperature_unit=fahrenheit&timezone=auto&current=temperature_2m,weather_code",
        location.lat, location.lon
    );
    let data = fetch_json(client, &url).await?;
    let current = data.get("current").cloned().unwrap_or_else(|| json!({}));
    let temp_f = current
        .get("temperature_2m")
        .and_then(|v| v.as_f64())
        .ok_or_else(|| "Missing temperature from forecast".to_string())?;
    let weather = describe_weather_code(
        current
            .get("weather_code")
            .and_then(|v| v.as_i64())
            .unwrap_or(-1),
    );
    Ok((temp_f, weather))
}

fn format_label(temp_f: f64, place: &str) -> String {
    let temp = format!("{}°", temp_f.round() as i64);
    let place = place.trim();
    if place.is_empty() {
        temp
    } else {
        format!("{temp} · {place}")
    }
}

pub async fn current_for_zip(zip: &str) -> Result<CurrentWeather, String> {
    let normalized =
        normalize_zip(zip).ok_or_else(|| "Invalid ZIP code (expected 5 US digits)".to_string())?;
    let client = Client::new();
    let location = geocode_zip(&client, &normalized).await?;
    let (temp_f, weather) = fetch_current_temp(&client, &location).await?;
    Ok(CurrentWeather {
        temp_f,
        place: location.place.clone(),
        state: location.state,
        zip: location.zip,
        weather,
        label: format_label(temp_f, &location.place),
    })
}

pub async fn current_from_settings(chains: &WriteChains) -> Result<CurrentWeather, String> {
    let settings = settings::get_settings(chains).await;
    let zip = settings
        .get("weather")
        .and_then(|v| v.get("defaultZip"))
        .and_then(|v| v.as_str())
        .unwrap_or(DEFAULT_ZIP)
        .trim();
    let zip = if zip.is_empty() { DEFAULT_ZIP } else { zip };
    current_for_zip(zip).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn weather_get_current(
    state: tauri::State<'_, crate::memory::AppState>,
) -> Result<CurrentWeather, String> {
    current_from_settings(&state.write_chains).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_zip_takes_first_five_digits() {
        assert_eq!(normalize_zip("12528").as_deref(), Some("12528"));
        assert_eq!(normalize_zip("12528-1234").as_deref(), Some("12528"));
        assert_eq!(normalize_zip("abc"), None);
        assert_eq!(normalize_zip("123"), None);
    }

    #[test]
    fn format_label_includes_place_when_present() {
        assert_eq!(format_label(72.4, "Highland"), "72° · Highland");
        assert_eq!(format_label(72.4, "  "), "72°");
    }
}
