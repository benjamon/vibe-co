// Weather Hub — sourced entirely from Open-Meteo's free, keyless APIs.
// Forecast: https://open-meteo.com/en/docs
// Air quality: https://open-meteo.com/en/docs/air-quality-api

const CITIES = [
  { name: "Seattle", region: "Washington, US", lat: 47.6062, lon: -122.3321, flight: null },
  { name: "Bellingham", region: "Washington, US", lat: 48.7519, lon: -122.4787, flight: null },
  {
    name: "Hermosa Beach",
    region: "California, US",
    lat: 33.8622,
    lon: -118.3995,
    flight: { originCode: "BLI", originName: "Bellingham", destCode: "LAX", estimate: "$180–260" },
  },
  {
    name: "Austin",
    region: "Texas, US",
    lat: 30.2672,
    lon: -97.7431,
    flight: { originCode: "SEA", originName: "Seattle", destCode: "AUS", estimate: "$300–350" },
  },
  {
    name: "Miami",
    region: "Florida, US",
    lat: 25.7617,
    lon: -80.1918,
    flight: { originCode: "SEA", originName: "Seattle", destCode: "MIA", estimate: "$300–350" },
  },
  {
    name: "New York",
    region: "New York, US",
    lat: 40.7128,
    lon: -74.006,
    flight: { originCode: "SEA", originName: "Seattle", destCode: "JFK", estimate: "$280–330" },
  },
];

// Round-trip fare estimates are researched (Skyscanner/Expedia/momondo/Google
// Flights snapshots), not a live feed — no free keyless flight-price API
// exists. Each tile links to a Google Flights search for a live quote on a
// 7-day round trip departing a few days out, picking whichever of
// BLI (Bellingham) or SEA (Seattle) came up cheaper in that research.
function flightWindow() {
  const out = new Date();
  out.setDate(out.getDate() + 5);
  const back = new Date(out);
  back.setDate(back.getDate() + 7);
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { out: fmt(out), back: fmt(back) };
}

function googleFlightsUrl(originCode, destCode, dateOut, dateBack) {
  const q = `Flights to ${destCode} from ${originCode} on ${dateOut} through ${dateBack}`;
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(q)}`;
}

// WMO weather codes -> [emoji, short label]
const WEATHER_CODES = {
  0: ["☀️", "Clear"],
  1: ["🌤️", "Mostly clear"],
  2: ["⛅", "Partly cloudy"],
  3: ["☁️", "Overcast"],
  45: ["🌫️", "Fog"],
  48: ["🌫️", "Rime fog"],
  51: ["🌦️", "Light drizzle"],
  53: ["🌦️", "Drizzle"],
  55: ["🌦️", "Dense drizzle"],
  56: ["🌧️", "Freezing drizzle"],
  57: ["🌧️", "Freezing drizzle"],
  61: ["🌧️", "Light rain"],
  63: ["🌧️", "Rain"],
  65: ["🌧️", "Heavy rain"],
  66: ["🌧️", "Freezing rain"],
  67: ["🌧️", "Freezing rain"],
  71: ["❄️", "Light snow"],
  73: ["❄️", "Snow"],
  75: ["❄️", "Heavy snow"],
  77: ["❄️", "Snow grains"],
  80: ["🌦️", "Rain showers"],
  81: ["🌦️", "Rain showers"],
  82: ["⛈️", "Violent showers"],
  85: ["🌨️", "Snow showers"],
  86: ["🌨️", "Snow showers"],
  95: ["⛈️", "Thunderstorm"],
  96: ["⛈️", "Thunderstorm + hail"],
  99: ["⛈️", "Thunderstorm + hail"],
};

function weatherInfo(code) {
  return WEATHER_CODES[code] || ["🌡️", "Unknown"];
}

function aqiBucket(aqi) {
  if (aqi == null) return { cls: "", text: "—" };
  if (aqi <= 50) return { cls: "good", text: aqi };
  if (aqi <= 100) return { cls: "warning", text: aqi };
  if (aqi <= 150) return { cls: "warning", text: aqi };
  if (aqi <= 200) return { cls: "serious", text: aqi };
  if (aqi <= 300) return { cls: "critical", text: aqi };
  return { cls: "critical", text: aqi };
}

function forecastUrl(lat, lon) {
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    current: "temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m,weather_code",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    precipitation_unit: "inch",
    timezone: "auto",
    forecast_days: "10",
  });
  return `https://api.open-meteo.com/v1/forecast?${params}`;
}

function airQualityUrl(lat, lon) {
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    current: "us_aqi",
    timezone: "auto",
  });
  return `https://air-quality-api.open-meteo.com/v1/air-quality?${params}`;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json();
}

function renderFlightTile(card, city) {
  const valueEl = card.querySelector(".flights-value");
  if (!city.flight) {
    valueEl.innerHTML = `<span class="flights-muted">&mdash;</span>`;
    return;
  }
  const { originCode, originName, destCode, estimate } = city.flight;
  const { out, back } = flightWindow();
  const url = googleFlightsUrl(originCode, destCode, out, back);
  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener";
  link.className = "flight-link";
  link.title = `Round trip, ${originName} (${originCode}) → ${destCode}, ${out} → ${back}, est. ${estimate}`;
  link.setAttribute("aria-label", `Search round-trip flights from ${originName} to ${destCode}, estimated ${estimate}`);
  link.textContent = "✈️";
  valueEl.innerHTML = "";
  valueEl.appendChild(link);
}

function buildCard(city) {
  const template = document.getElementById("city-card-template");
  const node = template.content.cloneNode(true);
  const card = node.querySelector(".city-card");
  card.querySelector(".city-name").textContent = city.name;
  card.querySelector(".city-region").textContent = city.region;
  card.dataset.city = city.name;
  renderFlightTile(card, city);
  return { fragment: node, card };
}

function renderForecastDay(dayTemplate, dateStr, code, hi, lo, precipProb, isToday) {
  const node = dayTemplate.content.cloneNode(true);
  const [icon] = weatherInfo(code);
  const date = new Date(`${dateStr}T00:00:00`);
  const label = isToday ? "Today" : date.toLocaleDateString(undefined, { weekday: "short" });
  node.querySelector(".fday-label").textContent = label;
  node.querySelector(".fday-icon").textContent = icon;
  node.querySelector(".fday-hi").textContent = `${Math.round(hi)}°`;
  node.querySelector(".fday-lo").textContent = `${Math.round(lo)}°`;
  const precipEl = node.querySelector(".fday-precip");
  precipEl.textContent = precipProb != null && precipProb >= 20 ? `💧${precipProb}` : "";
  return node;
}

async function loadCity(city, card) {
  try {
    const [weather, air] = await Promise.allSettled([
      fetchJson(forecastUrl(city.lat, city.lon)),
      fetchJson(airQualityUrl(city.lat, city.lon)),
    ]);

    if (weather.status !== "fulfilled") throw weather.reason;

    const data = weather.value;
    const cur = data.current;
    const [icon, desc] = weatherInfo(cur.weather_code);

    card.querySelector(".current-icon").textContent = icon;
    card.querySelector(".temp-value").textContent = `${Math.round(cur.temperature_2m)}°F`;
    card.querySelector(".temp-desc").textContent = desc;
    card.querySelector(".feels-like").textContent = `Feels ${Math.round(cur.apparent_temperature)}°F`;

    card.querySelector(".wind-value").textContent = `${Math.round(cur.wind_speed_10m)} mph`;
    card.querySelector(".humidity-value").textContent = `${Math.round(cur.relative_humidity_2m)}%`;

    const aqiValue = air.status === "fulfilled" ? air.value?.current?.us_aqi : null;
    const bucket = aqiBucket(aqiValue);
    const dot = card.querySelector(".aqi-dot");
    dot.className = "aqi-dot" + (bucket.cls ? ` ${bucket.cls}` : "");
    card.querySelector(".aqi-text").textContent = bucket.text;

    const strip = card.querySelector(".forecast-strip");
    strip.innerHTML = "";
    const dayTemplate = document.getElementById("forecast-day-template");
    const days = data.daily.time;
    const frag = document.createDocumentFragment();
    days.forEach((dateStr, i) => {
      frag.appendChild(
        renderForecastDay(
          dayTemplate,
          dateStr,
          data.daily.weather_code[i],
          data.daily.temperature_2m_max[i],
          data.daily.temperature_2m_min[i],
          data.daily.precipitation_probability_max?.[i],
          i === 0
        )
      );
    });
    strip.appendChild(frag);
  } catch (err) {
    const errorEl = card.querySelector(".card-error");
    errorEl.textContent = `Couldn't load weather for ${city.name}: ${err.message || err}`;
    errorEl.hidden = false;
  } finally {
    card.removeAttribute("aria-busy");
  }
}

async function loadAll() {
  const container = document.getElementById("cities");
  const refreshBtn = document.getElementById("refresh-btn");
  const updatedEl = document.getElementById("updated-at");

  refreshBtn.disabled = true;
  container.innerHTML = "";

  const cards = CITIES.map((city) => {
    const { fragment, card } = buildCard(city);
    container.appendChild(fragment);
    return { city, card: container.querySelector(`[data-city="${CSS.escape(city.name)}"]`) };
  });

  await Promise.all(cards.map(({ city, card }) => loadCity(city, card)));

  updatedEl.textContent = `Updated ${new Date().toLocaleTimeString()}`;
  refreshBtn.disabled = false;
}

document.getElementById("refresh-btn").addEventListener("click", loadAll);
loadAll();
