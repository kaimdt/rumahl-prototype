"""
Example: Simple data processor plugin
"""

from iora_sdk import DataProcessorPlugin, PluginContext
from typing import Any


class TemperatureConverter(DataProcessorPlugin):
    """
    Convert temperature between Celsius and Fahrenheit

    Settings:
    - mode: "c_to_f" or "f_to_c"
    """

    async def process(self, context: PluginContext, data: Any) -> Any:
        mode = context.settings.get("mode", "c_to_f")
        value = float(data)

        if mode == "c_to_f":
            # Celsius to Fahrenheit
            result = (value * 9 / 5) + 32
            await context.notify(
                "Temperature Converted", f"{value}°C = {result}°F", priority="low"
            )
            return result
        else:
            # Fahrenheit to Celsius
            result = (value - 32) * 5 / 9
            await context.notify(
                "Temperature Converted", f"{value}°F = {result}°C", priority="low"
            )
            return result
