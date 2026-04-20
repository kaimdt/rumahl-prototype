#pragma once

#include <string>
#include <vector>
#include <map>
#include <optional>
#include <nlohmann/json.hpp>

namespace iora {

using json = nlohmann::json;

/**
 * Smart home entity
 */
struct Entity {
    std::string entity_id;
    std::string state;
    json attributes;
    std::optional<std::string> last_changed;
    std::optional<std::string> last_updated;

    static Entity from_json(const json& j);
    json to_json() const;
};

/**
 * Service call to control an entity
 */
struct ServiceCall {
    std::string domain;
    std::string service;
    std::string entity_id;
    json service_data;

    json to_json() const;
};

/**
 * Notification action button
 */
struct NotificationAction {
    std::string action;
    std::string title;

    json to_json() const;
};

/**
 * Notification payload
 */
struct NotificationPayload {
    std::string title;
    std::string message;
    std::string priority = "normal";
    std::optional<std::string> icon;
    std::vector<NotificationAction> actions;

    json to_json() const;
};

/**
 * App settings
 */
struct AppSettings {
    std::string app_id;
    json settings;

    static AppSettings from_json(const json& j);
    json to_json() const;
};

/**
 * Health status
 */
struct HealthStatus {
    bool healthy;
    std::optional<std::string> message;
    json details;

    static HealthStatus from_json(const json& j);
    json to_json() const;
};

} // namespace iora
