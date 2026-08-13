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
  IoraClient,
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
  // ── ORA OS surface (Package 2: ora.*) ────────────────────────────────
  // The runtime manager sets IORA_ENDPOINT/IORA_APP_TOKEN; the SDK client
  // gives apps the same OS capabilities as the shell (jobs, files,
  // permissions, system events, devices, secrets).
  const ora = new IoraClient({
    baseUrl: process.env.IORA_ENDPOINT || "http://localhost:8126",
    apiKey: process.env.IORA_APP_TOKEN,
  });
  ora.setAppId(process.env.IORA_APP_ID || "weather-service");

  try {
    // Track weather refreshes as background jobs (Job Center UI).
    const job = await ora.jobs.create({
      name: "Weather refresh",
      job_type: "sync",
      source: "weather-service",
    });
    await ora.jobs.update(job.id, { progress: 50, message: "Fetching forecast…", status: "running" });
    await ora.jobs.update(job.id, { progress: 100, status: "completed" });

    // Ask the user for network access if missing (shell Allow/Deny dialog).
    await ora.permissions
      .request({ permission: "os.network.read", reason: "Detect weather station on the LAN" })
      .catch(() => {});

    // Report health into the system event log.
    await ora.system.reportEvent({
      severity: "info",
      source: "weather-service",
      message: "Weather app started",
    });
  } catch (error) {
    await runtime.log(LogLevel.WARNING, `OS integration skipped: ${error}`, null);
  }

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
