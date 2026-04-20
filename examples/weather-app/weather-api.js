const axios = require('axios');

class WeatherAPI {
  constructor(apiKey) {
    this.apiKey = apiKey || 'demo_key';
    this.baseURL = 'https://api.openweathermap.org/data/2.5';
  }

  async getCurrentWeather(location) {
    try {
      // Bei Demo-Key verwenden wir Mock-Daten
      if (this.apiKey === 'demo_key') {
        return this.getMockCurrentWeather(location);
      }

      const response = await axios.get(`${this.baseURL}/weather`, {
        params: {
          q: location,
          appid: this.apiKey,
          units: 'metric',
          lang: 'de'
        },
        timeout: 5000 // 5 Sekunden Timeout
      });

      return this.formatCurrentWeather(response.data);
    } catch (error) {
      if (error.code === 'ECONNABORTED') {
        throw new Error('Weather API timeout');
      }
      throw new Error(`Weather API error: ${error.message}`);
    }
  }

  async getForecast(location) {
    try {
      // Bei Demo-Key verwenden wir Mock-Daten
      if (this.apiKey === 'demo_key') {
        return this.getMockForecast(location);
      }

      const response = await axios.get(`${this.baseURL}/forecast`, {
        params: {
          q: location,
          appid: this.apiKey,
          units: 'metric',
          lang: 'de'
        },
        timeout: 5000
      });

      return this.formatForecast(response.data);
    } catch (error) {
      if (error.code === 'ECONNABORTED') {
        throw new Error('Weather API timeout');
      }
      throw new Error(`Weather API error: ${error.message}`);
    }
  }

  formatCurrentWeather(data) {
    return {
      temperature: Math.round(data.main.temp * 10) / 10,
      feels_like: Math.round(data.main.feels_like * 10) / 10,
      condition: data.weather[0].description,
      humidity: data.main.humidity,
      pressure: data.main.pressure,
      wind_speed: data.wind.speed,
      wind_direction: data.wind.deg,
      clouds: data.clouds.all,
      location: data.name,
      country: data.sys.country,
      sunrise: new Date(data.sys.sunrise * 1000).toISOString(),
      sunset: new Date(data.sys.sunset * 1000).toISOString(),
      timestamp: new Date().toISOString()
    };
  }

  formatForecast(data) {
    const dailyForecasts = {};

    // Gruppiere nach Tagen
    data.list.forEach(item => {
      const date = item.dt_txt.split(' ')[0];
      if (!dailyForecasts[date]) {
        dailyForecasts[date] = [];
      }
      dailyForecasts[date].push(item);
    });

    // Erstelle Tages-Zusammenfassungen
    const forecast = Object.keys(dailyForecasts).slice(0, 7).map(date => {
      const dayData = dailyForecasts[date];
      const temps = dayData.map(d => d.main.temp);

      return {
        date,
        temp_min: Math.round(Math.min(...temps) * 10) / 10,
        temp_max: Math.round(Math.max(...temps) * 10) / 10,
        condition: dayData[0].weather[0].description,
        humidity: Math.round(dayData.reduce((sum, d) => sum + d.main.humidity, 0) / dayData.length),
        wind_speed: Math.round(dayData.reduce((sum, d) => sum + d.wind.speed, 0) / dayData.length * 10) / 10,
        rain_probability: dayData[0].pop ? Math.round(dayData[0].pop * 100) : 0
      };
    });

    return {
      location: data.city.name,
      country: data.city.country,
      forecast,
      timestamp: new Date().toISOString()
    };
  }

  getMockCurrentWeather(location) {
    return {
      temperature: 18.5,
      feels_like: 17.2,
      condition: 'Teilweise bewölkt',
      humidity: 65,
      pressure: 1013,
      wind_speed: 12.3,
      wind_direction: 180,
      clouds: 40,
      location: location,
      country: 'DE',
      sunrise: new Date().toISOString(),
      sunset: new Date().toISOString(),
      timestamp: new Date().toISOString()
    };
  }

  getMockForecast(location) {
    const forecast = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date();
      date.setDate(date.getDate() + i);

      forecast.push({
        date: date.toISOString().split('T')[0],
        temp_min: 12 + Math.random() * 5,
        temp_max: 18 + Math.random() * 8,
        condition: ['Sonnig', 'Bewölkt', 'Regen', 'Teilweise bewölkt'][Math.floor(Math.random() * 4)],
        humidity: 60 + Math.floor(Math.random() * 20),
        wind_speed: 8 + Math.random() * 10,
        rain_probability: Math.floor(Math.random() * 100)
      });
    }

    return {
      location,
      country: 'DE',
      forecast,
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = WeatherAPI;
