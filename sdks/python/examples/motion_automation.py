"""
Example: Motion-activated light automation
"""

from rumahl_sdk import AutomationPlugin, PluginContext
from typing import Dict, Any


class MotionLightAutomation(AutomationPlugin):
    """
    Turn on lights when motion is detected

    Settings:
    - light_entity_id: Entity ID of light to control
    - motion_sensor_id: Entity ID of motion sensor
    - brightness: Brightness level (0-255)
    - timeout: Auto-off timeout in seconds
    """

    async def on_event(self, context: PluginContext, event: Dict[str, Any]) -> None:
        # Check if this is a state change event
        if event.get("type") != "entity_state_changed":
            return

        entity_id = event["data"]["entity_id"]
        new_state = event["data"]["new_state"]

        # Get configured motion sensor
        motion_sensor_id = context.settings.get("motion_sensor_id")
        if entity_id != motion_sensor_id:
            return

        # Get light settings
        light_id = context.settings.get("light_entity_id")
        brightness = context.settings.get("brightness", 255)

        # Turn on light when motion detected
        if new_state == "on":
            await context.call_service("light", "turn_on", light_id, {"brightness": brightness})

            await context.notify(
                "Motion Detected", f"Turned on {light_id} at {brightness} brightness"
            )

            # Store activation time
            import time

            await context.store("last_activation", time.time())

        # Turn off light when motion clears
        elif new_state == "off":
            timeout = context.settings.get("timeout", 60)

            # Wait for timeout
            import asyncio

            await asyncio.sleep(timeout)

            # Check if motion is still off
            sensor = await context.get_entity(motion_sensor_id)
            if sensor.state == "off":
                await context.call_service("light", "turn_off", light_id)
                await context.notify("Auto-Off", f"Turned off {light_id} after {timeout}s")
