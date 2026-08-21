#pragma once

#include <string>
#include <vector>
#include <map>
#include <memory>
#include <nlohmann/json.hpp>

namespace ora {

using json = nlohmann::json;

// Forward declarations
class Entity;
class ServiceCall;
class NotificationPayload;
class AppSettings;

/**
 * rumahl API Client
 *
 * HTTP client for interacting with rumahl APIs
 */
class Client {
public:
    explicit Client(const std::string& base_url = "http://localhost:8080",
                   const std::string& api_key = "");

    void set_api_key(const std::string& api_key);

    // Entity API
    std::vector<Entity> get_entities();
    Entity get_entity(const std::string& entity_id);
    void call_service(const ServiceCall& call);
    void turn_on(const std::string& entity_id, const json& data = json::object());
    void turn_off(const std::string& entity_id);

    // Notifications API
    void send_notification(const NotificationPayload& notification);
    std::vector<json> get_notifications();

    // Storage API
    void set_storage(const std::string& key, const json& value);
    json get_storage(const std::string& key);
    void delete_storage(const std::string& key);

    // Settings API
    AppSettings get_settings(const std::string& app_id);
    void update_settings(const std::string& app_id, const json& settings);

private:
    std::string base_url_;
    std::string api_key_;

    json request(const std::string& method, const std::string& path, const json& body = json());
    std::string get_entity_domain(const std::string& entity_id);
};

} // namespace ora
