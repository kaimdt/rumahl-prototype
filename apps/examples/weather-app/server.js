const express = require('express');
const WeatherAPI = require('./weather-api');
const Cache = require('./cache');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Initialize services
const weatherAPI = new WeatherAPI(process.env.WEATHER_API_KEY);
const cache = new Cache(process.env.CACHE_TTL || 300); // 5 Minuten Standard

// Health Check Endpoint
app.get('/api/weather/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'weather-service',
    version: '1.0.0',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// Aktuelle Wetterdaten
app.get('/api/weather/current', async (req, res) => {
  try {
    const location = req.query.location || 'Berlin';

    // Prüfe Cache
    const cacheKey = `current_${location}`;
    const cached = cache.get(cacheKey);

    if (cached) {
      console.log(`Cache hit for ${location}`);
      return res.json({
        ...cached,
        cached: true
      });
    }

    // Rufe Daten von API ab
    console.log(`Fetching weather for ${location} from API`);
    const weather = await weatherAPI.getCurrentWeather(location);

    // Cache Ergebnis
    cache.set(cacheKey, weather);

    res.json({
      ...weather,
      cached: false
    });
  } catch (error) {
    console.error('Error fetching current weather:', error);
    res.status(500).json({
      error: 'Failed to fetch weather data',
      message: error.message
    });
  }
});

// 7-Tage Vorhersage
app.get('/api/weather/forecast', async (req, res) => {
  try {
    const location = req.query.location || 'Berlin';

    // Prüfe Cache
    const cacheKey = `forecast_${location}`;
    const cached = cache.get(cacheKey);

    if (cached) {
      console.log(`Cache hit for forecast ${location}`);
      return res.json({
        ...cached,
        cached: true
      });
    }

    // Rufe Daten von API ab
    console.log(`Fetching forecast for ${location} from API`);
    const forecast = await weatherAPI.getForecast(location);

    // Cache Ergebnis
    cache.set(cacheKey, forecast);

    res.json({
      ...forecast,
      cached: false
    });
  } catch (error) {
    console.error('Error fetching forecast:', error);
    res.status(500).json({
      error: 'Failed to fetch forecast data',
      message: error.message
    });
  }
});

// Widget bereitstellen
app.get('/widget.js', (req, res) => {
  res.sendFile(__dirname + '/widget/WeatherWidget.js');
});

// Cache-Statistiken (für Debugging)
app.get('/api/weather/cache-stats', (req, res) => {
  res.json(cache.getStats());
});

// Graceful Shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

// Fehlerbehandlung
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message
  });
});

// Server starten
const server = app.listen(PORT, () => {
  console.log(`Weather Service running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/weather/health`);
});

module.exports = app;
