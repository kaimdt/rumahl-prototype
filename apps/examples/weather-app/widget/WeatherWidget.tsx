import React, { useState, useEffect } from 'react';

export function WeatherWidget({ config, apiToken }) {
  const [weather, setWeather] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const location = config?.location || 'Berlin';

  useEffect(() => {
    const fetchWeather = async () => {
      try {
        setLoading(true);
        const response = await fetch(
          `http://iora-core:8090/api/gateway/weather/current?location=${location}`,
          {
            headers: {
              'Authorization': `Bearer ${apiToken}`
            }
          }
        );

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        setWeather(data);
        setError(null);
      } catch (err) {
        setError(err.message);
        setWeather(null);
      } finally {
        setLoading(false);
      }
    };

    fetchWeather();
    const interval = setInterval(fetchWeather, 300000); // Update alle 5 Minuten

    return () => clearInterval(interval);
  }, [location, apiToken]);

  if (loading) {
    return (
      <div className="weather-widget loading">
        <div className="spinner"></div>
        <p>Lade Wetterdaten...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="weather-widget error">
        <p className="error-icon">⚠️</p>
        <p>Fehler beim Laden: {error}</p>
      </div>
    );
  }

  if (!weather) {
    return (
      <div className="weather-widget no-data">
        <p>Keine Wetterdaten verfügbar</p>
      </div>
    );
  }

  const getWeatherIcon = (condition) => {
    const lowerCondition = condition.toLowerCase();
    if (lowerCondition.includes('sonnig') || lowerCondition.includes('klar')) return '☀️';
    if (lowerCondition.includes('bewölkt')) return '☁️';
    if (lowerCondition.includes('regen')) return '🌧️';
    if (lowerCondition.includes('schnee')) return '❄️';
    if (lowerCondition.includes('gewitter')) return '⛈️';
    if (lowerCondition.includes('nebel')) return '🌫️';
    return '🌤️';
  };

  return (
    <div className="weather-widget">
      <div className="weather-header">
        <h3>{weather.location}</h3>
        {weather.cached && <span className="cache-badge">Cached</span>}
      </div>

      <div className="weather-main">
        <div className="weather-icon">
          {getWeatherIcon(weather.condition)}
        </div>
        <div className="weather-temp">
          <span className="temp-value">{Math.round(weather.temperature)}</span>
          <span className="temp-unit">°C</span>
        </div>
      </div>

      <div className="weather-condition">
        {weather.condition}
      </div>

      <div className="weather-details">
        <div className="detail">
          <span className="label">Gefühlt</span>
          <span className="value">{Math.round(weather.feels_like)}°C</span>
        </div>
        <div className="detail">
          <span className="label">Luftfeuchtigkeit</span>
          <span className="value">{weather.humidity}%</span>
        </div>
        <div className="detail">
          <span className="label">Wind</span>
          <span className="value">{weather.wind_speed} km/h</span>
        </div>
        <div className="detail">
          <span className="label">Bewölkung</span>
          <span className="value">{weather.clouds}%</span>
        </div>
      </div>

      <div className="weather-footer">
        <span className="last-update">
          Aktualisiert: {new Date(weather.timestamp).toLocaleTimeString('de-DE')}
        </span>
      </div>

      <style jsx>{`
        .weather-widget {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          border-radius: 16px;
          padding: 20px;
          color: white;
          box-shadow: 0 8px 16px rgba(0, 0, 0, 0.1);
          min-width: 280px;
        }

        .weather-widget.loading,
        .weather-widget.error,
        .weather-widget.no-data {
          text-align: center;
          padding: 40px 20px;
          background: #f5f5f5;
          color: #666;
        }

        .spinner {
          border: 3px solid #f3f3f3;
          border-top: 3px solid #667eea;
          border-radius: 50%;
          width: 40px;
          height: 40px;
          animation: spin 1s linear infinite;
          margin: 0 auto 16px;
        }

        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        .error-icon {
          font-size: 48px;
          margin-bottom: 8px;
        }

        .weather-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 16px;
        }

        .weather-header h3 {
          margin: 0;
          font-size: 18px;
          font-weight: 600;
        }

        .cache-badge {
          background: rgba(255, 255, 255, 0.2);
          padding: 2px 8px;
          border-radius: 12px;
          font-size: 10px;
          font-weight: 500;
        }

        .weather-main {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 16px;
          margin: 24px 0;
        }

        .weather-icon {
          font-size: 64px;
        }

        .weather-temp {
          display: flex;
          align-items: flex-start;
        }

        .temp-value {
          font-size: 56px;
          font-weight: 700;
          line-height: 1;
        }

        .temp-unit {
          font-size: 24px;
          margin-top: 8px;
          margin-left: 4px;
          opacity: 0.8;
        }

        .weather-condition {
          text-align: center;
          font-size: 16px;
          font-weight: 500;
          margin-bottom: 20px;
          text-transform: capitalize;
        }

        .weather-details {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 12px;
          margin-bottom: 16px;
        }

        .detail {
          background: rgba(255, 255, 255, 0.15);
          padding: 8px 12px;
          border-radius: 8px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .detail .label {
          font-size: 11px;
          opacity: 0.8;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .detail .value {
          font-size: 14px;
          font-weight: 600;
        }

        .weather-footer {
          text-align: center;
          margin-top: 16px;
          padding-top: 16px;
          border-top: 1px solid rgba(255, 255, 255, 0.2);
        }

        .last-update {
          font-size: 11px;
          opacity: 0.7;
        }
      `}</style>
    </div>
  );
}
