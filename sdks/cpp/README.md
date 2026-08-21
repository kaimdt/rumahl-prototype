# rumahl C++ SDK

Official C++ SDK for developing rumahl apps and plugins.

## Features

- ⚡ **Modern C++17** - Uses C++17 features and best practices
- 🔒 **Type Safety** - Strong typing with structs and enums
- 📦 **JSON Support** - Built on nlohmann/json for easy data handling
- 🔑 **Permission Management** - Built-in permission enums and helpers
- 📝 **Manifest Builder** - Fluent API for manifest creation
- 🎯 **REST API Client** - Complete rumahl API client using libcurl

## Requirements

- C++17 compatible compiler
- CMake 3.15+
- libcurl
- nlohmann/json 3.2.0+

## Installation

### Using CMake

```cmake
find_package(rumahl-sdk REQUIRED)
target_link_libraries(your_app PRIVATE ora::rumahl-sdk)
```

### Building from Source

```bash
mkdir build && cd build
cmake ..
cmake --build .
sudo cmake --install .
```

## Quick Start

### Simple App Example

```cpp
#include <ora/client.hpp>
#include <ora/types.hpp>
#include <iostream>

int main() {
    // Initialize client
    ora::Client client("http://localhost:8080", "your-api-key");

    // Get all entities
    auto entities = client.get_entities();
    std::cout << "Found " << entities.size() << " entities\n";

    // Turn on a light
    client.turn_on("light.living_room", {{"brightness", 255}});

    // Send notification
    ora::NotificationPayload notification{
        .title = "Hello rumahl",
        .message = "App is running!",
        .priority = "normal"
    };
    client.send_notification(notification);

    // Store data
    client.set_storage("last_run", {{"timestamp", "2024-01-01"}});

    // Get stored data
    auto data = client.get_storage("last_run");
    std::cout << "Data: " << data.dump() << "\n";

    return 0;
}
```

## API Reference

### Client

Main HTTP client for rumahl API interactions.

```cpp
ora::Client client("http://localhost:8080", "api-key");

// Entity API
auto entities = client.get_entities();
auto entity = client.get_entity("light.bedroom");

ora::ServiceCall call{
    .domain = "light",
    .service = "turn_on",
    .entity_id = "light.bedroom",
    .service_data = {{"brightness", 200}}
};
client.call_service(call);

client.turn_on("light.bedroom", {{"brightness", 200}});
client.turn_off("light.bedroom");

// Notifications
ora::NotificationPayload notification{
    .title = "Alert",
    .message = "Something happened",
    .priority = "high"
};
client.send_notification(notification);

// Storage
client.set_storage("key", {{"data", "value"}});
auto data = client.get_storage("key");
client.delete_storage("key");

// Settings
auto settings = client.get_settings("app-id");
client.update_settings("app-id", {{"theme", "dark"}});
```

### ManifestBuilder

```cpp
#include <ora/manifest.hpp>
#include <ora/permissions.hpp>

using namespace ora;

auto manifest = ManifestBuilder("my-app", "My App")
    .version("1.0.0")
    .developer("Your Name")
    .description("An awesome rumahl app")
    .permissions({
        Permission::READ_ENTITIES,
        Permission::CONTROL_ENTITIES,
        Permission::STORAGE_WRITE,
        Permission::SEND_NOTIFICATIONS
    })
    .custom_page({
        {"id", "dashboard"},
        {"title", "Dashboard"},
        {"icon", "chart-line"},
        {"url", "/dashboard"},
        {"iframe", true},
        {"iframe_config", {
            {"sandbox", json::array({"allow-scripts", "allow-same-origin"})},
            {"security_token", true}
        }}
    })
    .network_access({
        {"allowed_domains", json::array({"api.example.com"})},
        {"allow_user_domains", true}
    })
    .settings_schema({
        {"title", "App Settings"},
        {"fields", json::array({
            {
                {"key", "api_key"},
                {"label", "API Key"},
                {"type", "password"},
                {"required", true}
            }
        })}
    })
    .build();

// Save to file
ManifestBuilder("my-app", "My App")
    .version("1.0.0")
    .save("manifest.json");
```

### Permissions

```cpp
#include <ora/permissions.hpp>

// Use permissions
std::vector<Permission> perms = {
    Permission::READ_ENTITIES,
    Permission::CONTROL_ENTITIES,
    Permission::NETWORK_ACCESS
};

// Get risk level
auto risk = get_permission_risk_level(Permission::NETWORK_SCAN);
// Returns: RiskLevel::CRITICAL

// Get description
auto desc = get_permission_description(Permission::CAMERA_ACCESS);
// Returns: "Access camera"
```

## Complete Example

```cpp
#include <ora/client.hpp>
#include <ora/types.hpp>
#include <ora/manifest.hpp>
#include <iostream>
#include <thread>
#include <chrono>

class WeatherApp {
public:
    WeatherApp(const std::string& rumahl_url, const std::string& api_key)
        : client_(rumahl_url, api_key), app_id_("weather-app") {}

    void run() {
        // Get settings
        auto settings = client_.get_settings(app_id_);
        std::string weather_api_key = settings.settings["weather_api_key"];
        int update_interval = settings.settings.value("update_interval", 300);

        while (true) {
            try {
                update_weather(weather_api_key);
            } catch (const std::exception& e) {
                std::cerr << "Error: " << e.what() << "\n";
            }

            std::this_thread::sleep_for(std::chrono::seconds(update_interval));
        }
    }

private:
    void update_weather(const std::string& api_key) {
        // Fetch and process weather data
        // (Implementation would use actual HTTP client)

        // Send alert if severe
        ora::NotificationPayload notification{
            .title = "Severe Weather Alert",
            .message = "Storm expected in your area",
            .priority = "high"
        };
        client_.send_notification(notification);
    }

    ora::Client client_;
    std::string app_id_;
};

ora::AppManifest create_manifest() {
    return ora::ManifestBuilder("weather-app", "Weather Dashboard")
        .version("1.0.0")
        .developer("Your Name")
        .description("Real-time weather monitoring")
        .permissions({
            ora::Permission::STORAGE_WRITE,
            ora::Permission::SEND_NOTIFICATIONS,
            ora::Permission::NETWORK_OUTBOUND
        })
        .network_access({
            {"allowed_domains", json::array({"api.weather.com"})}
        })
        .build();
}

int main() {
    // Create and save manifest
    auto manifest = create_manifest();
    std::ofstream file("manifest.json");
    file << manifest.to_json().dump(2);
    file.close();

    // Run app
    WeatherApp app("http://localhost:8080", "your-api-key");
    app.run();

    return 0;
}
```

## Building Your App

### CMakeLists.txt

```cmake
cmake_minimum_required(VERSION 3.15)
project(my-app)

set(CMAKE_CXX_STANDARD 17)

find_package(rumahl-sdk REQUIRED)

add_executable(my-app main.cpp)
target_link_libraries(my-app PRIVATE ora::rumahl-sdk)
```

### Dockerfile

```dockerfile
FROM ubuntu:22.04

RUN apt-get update && apt-get install -y \
    build-essential \
    cmake \
    libcurl4-openssl-dev \
    nlohmann-json3-dev

WORKDIR /app
COPY . .

RUN mkdir build && cd build && \
    cmake .. && \
    cmake --build .

CMD ["./build/my-app"]
```

## Best Practices

### 1. Error Handling

```cpp
try {
    auto entity = client.get_entity("light.bedroom");
} catch (const std::exception& e) {
    std::cerr << "Error: " << e.what() << "\n";
}
```

### 2. RAII and Smart Pointers

```cpp
auto client = std::make_unique<ora::Client>("http://localhost:8080");
```

### 3. Minimal Permissions

```cpp
.permissions({
    Permission::READ_ENTITIES,  // Only what you need
    Permission::STORAGE_READ
})
```

## Compiler Support

- GCC 7+
- Clang 5+
- MSVC 2017+

## License

MIT

## Support

For issues and questions:
- GitHub Issues: https://github.com/ora/rumahl-sdk-cpp
- Documentation: https://docs.ora.io
- Community: https://community.ora.io
