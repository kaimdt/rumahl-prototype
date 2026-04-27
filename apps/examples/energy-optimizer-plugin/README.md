# Energy Optimizer AI Plugin

An intelligent plugin that uses ORA AI to analyze and optimize your home energy consumption.

## Features

- 🔋 **Real-time Energy Analysis** - Analyzes current power consumption across all devices
- 📊 **High Consumer Detection** - Identifies devices using the most energy
- ⏰ **Smart Scheduling** - Recommends optimal times to run appliances based on electricity rates
- 💡 **AI-Powered Insights** - Uses ORA AI to provide personalized energy-saving tips
- 💰 **Cost Savings** - Estimates potential savings by shifting device usage to off-peak hours

## How It Works

This plugin registers two AI tools that ORA can use:

### 1. Energy Usage Analysis
```typescript
analyze_energy_usage(area?, timeframe?)
```
- Analyzes power consumption across all energy sensors
- Identifies high-consuming devices (>100W)
- Calculates total consumption
- Provides actionable recommendations

### 2. Smart Scheduling
```typescript
create_energy_schedule(device_type, priority?)
```
- Recommends optimal times to run appliances
- Considers time-of-use electricity rates
- Prioritizes based on user urgency
- Estimates potential cost savings

## Installation

1. Copy this plugin to your IORA plugins directory
2. The plugin will auto-register when IORA starts
3. ORA AI can now answer energy-related questions

## Usage Examples

### Ask ORA AI:

**"Show me my current energy usage"**
- ORA calls `analyze_energy_usage`
- Returns total power, high consumers, and recommendations

**"When should I run the dishwasher?"**
- ORA calls `create_energy_schedule` with `device_type='dishwasher'`
- Recommends off-peak hours for maximum savings

**"How can I reduce my electricity bill?"**
- ORA analyzes your consumption patterns
- Suggests specific devices to turn off or reschedule

**"Schedule my EV charging for the cheapest time"**
- ORA calls `create_energy_schedule` with `device_type='ev_charger'` and `priority='low'`
- Recommends overnight charging during off-peak hours

## Configuration

Edit `plugin.json` to customize:

- `electricity_rate_peak`: Your peak electricity rate (€/kWh)
- `electricity_rate_offpeak`: Your off-peak electricity rate (€/kWh)
- `offpeak_hours`: Array of hours (0-23) considered off-peak

Default configuration:
```json
{
  "electricity_rate_peak": 0.35,
  "electricity_rate_offpeak": 0.22,
  "offpeak_hours": [0, 1, 2, 3, 4, 5, 6, 22, 23]
}
```

## Requirements

- IORA Home with ORA AI enabled
- Home Assistant with power/energy sensors
- Supported entities:
  - `sensor.*_power` - Current power consumption (W)
  - `sensor.*_energy` - Cumulative energy usage (kWh)

## Example Conversation

**User**: "What's using the most power right now?"

**ORA AI**: *[calls analyze_energy_usage]*

"I've analyzed your current energy consumption. You're using **1,850W** total across 12 devices. The top consumers are:

1. **Electric Heater** (Living Room) - 1,200W
2. **Oven** (Kitchen) - 350W
3. **TV & Entertainment** (Living Room) - 180W

💡 **Recommendations:**
- The electric heater is using significant power. Consider reducing temperature by 1-2°C
- Your oven is currently on. Remember to turn it off when finished
- Total consumption is moderate for this time of day"

---

**User**: "When should I charge my electric car?"

**ORA AI**: *[calls create_energy_schedule with device_type='ev_charger']*

"For optimal cost savings, I recommend charging your EV **tonight at 22:00** (in 6 hours).

⚡ **Reasoning:**
- Current time is peak hours (expensive electricity)
- Off-peak rates start at 22:00
- **Estimated savings: 30-40% cost reduction** vs charging now

If you need to charge urgently, you can start now, but waiting will save approximately **€5-8 per charge** based on typical EV battery sizes."

## Technical Details

- **Plugin Type**: Service Plugin
- **Permissions**: `homeassistant`, `storage`, `ai`
- **AI Tools**: 2 registered tools
- **Auto-start**: Yes
- **Health Check**: Included

## Development

To modify this plugin:

1. Edit `src/index.ts`
2. Update tool parameters or handler logic
3. Reload IORA to apply changes

## Support

For issues or questions:
- GitHub: https://github.com/kaimdt/home-assistant-dashb/issues
- Documentation: [ORA_AI_PLUGIN_INTEGRATION.md](../../ORA_AI_PLUGIN_INTEGRATION.md)

## License

MIT License - See repository for details

## Author

IORA Team - Example plugin demonstrating AI integration capabilities
