#include "iora/types.hpp"

namespace iora {

Entity Entity::from_json(const json& j) {
    Entity entity;
    entity.entity_id = j.at("entity_id").get<std::string>();
    entity.state = j.at("state").get<std::string>();
    entity.attributes = j.value("attributes", json::object());

    if (j.contains("last_changed") && !j["last_changed"].is_null()) {
        entity.last_changed = j["last_changed"].get<std::string>();
    }
    if (j.contains("last_updated") && !j["last_updated"].is_null()) {
        entity.last_updated = j["last_updated"].get<std::string>();
    }

    return entity;
}

json Entity::to_json() const {
    json j = {
        {"entity_id", entity_id},
        {"state", state},
        {"attributes", attributes}
    };

    if (last_changed) {
        j["last_changed"] = *last_changed;
    }
    if (last_updated) {
        j["last_updated"] = *last_updated;
    }

    return j;
}

json ServiceCall::to_json() const {
    return {
        {"domain", domain},
        {"service", service},
        {"entity_id", entity_id},
        {"service_data", service_data}
    };
}

json NotificationAction::to_json() const {
    return {
        {"action", action},
        {"title", title}
    };
}

json NotificationPayload::to_json() const {
    json j = {
        {"title", title},
        {"message", message},
        {"priority", priority}
    };

    if (icon) {
        j["icon"] = *icon;
    }

    if (!actions.empty()) {
        json actions_array = json::array();
        for (const auto& action : actions) {
            actions_array.push_back(action.to_json());
        }
        j["actions"] = actions_array;
    }

    return j;
}

AppSettings AppSettings::from_json(const json& j) {
    AppSettings settings;
    settings.app_id = j.at("app_id").get<std::string>();
    settings.settings = j.value("settings", json::object());
    return settings;
}

json AppSettings::to_json() const {
    return {
        {"app_id", app_id},
        {"settings", settings}
    };
}

HealthStatus HealthStatus::from_json(const json& j) {
    HealthStatus status;
    status.healthy = j.at("healthy").get<bool>();

    if (j.contains("message") && !j["message"].is_null()) {
        status.message = j["message"].get<std::string>();
    }

    status.details = j.value("details", json::object());
    return status;
}

json HealthStatus::to_json() const {
    json j = {
        {"healthy", healthy},
        {"details", details}
    };

    if (message) {
        j["message"] = *message;
    }

    return j;
}

} // namespace iora
