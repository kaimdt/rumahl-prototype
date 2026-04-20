/**
 * Example app demonstrating the enhanced runtime features
 *
 * This example shows how to use the new IORA SDK runtime manager:
 * - Automatic heartbeat
 * - Status reporting
 * - Centralized logging
 * - Dynamic permission requests
 * - Bidirectional communication with IORA
 */

import {
  RuntimeManager,
  AppStatus,
  LogLevel,
  Permission,
} from "@iora/sdk";

async function main() {
  // Initialize runtime manager from environment variables
  // IORA sets these when starting the app:
  // - IORA_APP_ID
  // - IORA_ENDPOINT
  // - IORA_HEARTBEAT_INTERVAL
  const runtime = RuntimeManager.fromEnv();

  // Start the runtime (begins heartbeat, message processing, etc.)
  await runtime.start();

  // Log that app started
  await runtime.log(
    LogLevel.INFO,
    "Weather app started successfully",
    { version: "1.0.0" }
  );

  // Run the weather app
  await runWeatherApp(runtime);
}

async function runWeatherApp(runtime: RuntimeManager) {
  // Register custom query handler
  runtime.registerQueryHandler("get_weather", (params) => {
    return {
      temperature: 25.0,
      condition: "Sunny",
      humidity: 60,
    };
  });

  while (true) {
    try {
      // Update status to processing
      await runtime.setStatus(
        AppStatus.PROCESSING,
        "Fetching weather data"
      );

      // Request permission to access network
      const token = await runtime.requestPermission(
        Permission.NETWORK_OUTBOUND,
        "Fetch weather data from api.weather.com",
        300 // 5 minutes
      );

      if (token) {
        await runtime.log(
          LogLevel.DEBUG,
          "Permission granted for network access",
          { tokenExpires: token.expiresAt }
        );

        // Simulate fetching weather data
        await sleep(2000);

        await runtime.log(
          LogLevel.INFO,
          "Weather data updated successfully",
          { temperature: 25.0, condition: "Sunny" }
        );
      } else {
        await runtime.log(
          LogLevel.WARNING,
          "Permission request pending",
          null
        );
      }

      // Update status to idle
      await runtime.setStatus(AppStatus.IDLE);

      // Wait before next update
      await sleep(60000);

    } catch (error) {
      await runtime.log(
        LogLevel.ERROR,
        `Error in app loop: ${error}`,
        null
      );
      await runtime.setStatus(
        AppStatus.ERROR,
        error instanceof Error ? error.message : String(error)
      );
      await sleep(10000);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Run the app
main().catch((error) => {
  console.error("Failed to start app:", error);
  process.exit(1);
});
