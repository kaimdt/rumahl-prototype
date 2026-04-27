"""
Example app demonstrating the enhanced runtime features

This example shows how to use the new IORA SDK runtime manager:
- Automatic heartbeat
- Status reporting
- Centralized logging
- Dynamic permission requests
- Bidirectional communication with IORA
"""

import asyncio
import logging
from iora_sdk import (
    RuntimeManager,
    AppStatus,
    LogLevel,
    Permission,
)

# Configure logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)


async def main():
    """Main app function"""
    # Initialize runtime manager from environment variables
    # IORA sets these when starting the app:
    # - IORA_APP_ID
    # - IORA_ENDPOINT
    # - IORA_HEARTBEAT_INTERVAL
    runtime = RuntimeManager.from_env()

    # Start the runtime (begins heartbeat, message processing, etc.)
    await runtime.start()

    # Log that app started
    await runtime.log(
        LogLevel.INFO, "Weather app started successfully", {"version": "1.0.0"}
    )

    # Simulate app lifecycle
    await run_weather_app(runtime)


async def run_weather_app(runtime: RuntimeManager):
    """Run the weather app"""

    # Register custom query handler
    def get_weather_handler(params):
        return {"temperature": 25.0, "condition": "Sunny", "humidity": 60}

    runtime.register_query_handler("get_weather", get_weather_handler)

    while True:
        try:
            # Update status to processing
            await runtime.set_status(
                AppStatus.PROCESSING, "Fetching weather data"
            )

            # Request permission to access network
            token = await runtime.request_permission(
                Permission.NETWORK_OUTBOUND,
                "Fetch weather data from api.weather.com",
                300,  # 5 minutes
            )

            if token:
                await runtime.log(
                    LogLevel.DEBUG,
                    "Permission granted for network access",
                    {"token_expires": token.expires_at},
                )

                # Simulate fetching weather data
                await asyncio.sleep(2)

                await runtime.log(
                    LogLevel.INFO,
                    "Weather data updated successfully",
                    {"temperature": 25.0, "condition": "Sunny"},
                )
            else:
                await runtime.log(
                    LogLevel.WARNING,
                    "Permission request pending",
                    None,
                )

            # Update status to idle
            await runtime.set_status(AppStatus.IDLE)

            # Wait before next update
            await asyncio.sleep(60)

        except Exception as e:
            await runtime.log(LogLevel.ERROR, f"Error in app loop: {e}", None)
            await runtime.set_status(AppStatus.ERROR, str(e))
            await asyncio.sleep(10)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("Shutting down...")
