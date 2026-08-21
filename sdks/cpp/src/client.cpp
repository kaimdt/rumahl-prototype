#include "ora/client.hpp"
#include "ora/types.hpp"
#include <curl/curl.h>
#include <stdexcept>
#include <sstream>

namespace ora {

// Helper function for CURL write callback
static size_t write_callback(void* contents, size_t size, size_t nmemb, std::string* userp) {
    userp->append((char*)contents, size * nmemb);
    return size * nmemb;
}

Client::Client(const std::string& base_url, const std::string& api_key)
    : base_url_(base_url), api_key_(api_key) {
    // Remove trailing slash
    if (!base_url_.empty() && base_url_.back() == '/') {
        base_url_.pop_back();
    }
}

void Client::set_api_key(const std::string& api_key) {
    api_key_ = api_key;
}

json Client::request(const std::string& method, const std::string& path, const json& body) {
    CURL* curl = curl_easy_init();
    if (!curl) {
        throw std::runtime_error("Failed to initialize CURL");
    }

    std::string response_string;
    std::string url = base_url_ + path;

    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, write_callback);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response_string);

    // Set headers
    struct curl_slist* headers = nullptr;
    headers = curl_slist_append(headers, "Content-Type: application/json");
    if (!api_key_.empty()) {
        std::string auth_header = "Authorization: Bearer " + api_key_;
        headers = curl_slist_append(headers, auth_header.c_str());
    }
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);

    // Set method and body
    if (method == "POST") {
        curl_easy_setopt(curl, CURLOPT_POST, 1L);
        if (!body.is_null()) {
            std::string body_str = body.dump();
            curl_easy_setopt(curl, CURLOPT_POSTFIELDS, body_str.c_str());
        }
    } else if (method == "PUT") {
        curl_easy_setopt(curl, CURLOPT_CUSTOMREQUEST, "PUT");
        if (!body.is_null()) {
            std::string body_str = body.dump();
            curl_easy_setopt(curl, CURLOPT_POSTFIELDS, body_str.c_str());
        }
    } else if (method == "DELETE") {
        curl_easy_setopt(curl, CURLOPT_CUSTOMREQUEST, "DELETE");
    }

    // Perform request
    CURLcode res = curl_easy_perform(curl);
    long response_code = 0;
    curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &response_code);

    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);

    if (res != CURLE_OK) {
        throw std::runtime_error("CURL request failed: " + std::string(curl_easy_strerror(res)));
    }

    if (response_code >= 400) {
        throw std::runtime_error("API error (" + std::to_string(response_code) + "): " + response_string);
    }

    if (response_string.empty()) {
        return json();
    }

    return json::parse(response_string);
}

std::vector<Entity> Client::get_entities() {
    json response = request("GET", "/api/states");
    std::vector<Entity> entities;
    for (const auto& item : response) {
        entities.push_back(Entity::from_json(item));
    }
    return entities;
}

Entity Client::get_entity(const std::string& entity_id) {
    json response = request("GET", "/api/states/" + entity_id);
    return Entity::from_json(response);
}

void Client::call_service(const ServiceCall& call) {
    std::string path = "/api/services/" + call.domain + "/" + call.service;
    json body = {
        {"entity_id", call.entity_id},
        {"service_data", call.service_data}
    };
    request("POST", path, body);
}

void Client::turn_on(const std::string& entity_id, const json& data) {
    std::string domain = get_entity_domain(entity_id);
    ServiceCall call{domain, "turn_on", entity_id, data};
    call_service(call);
}

void Client::turn_off(const std::string& entity_id) {
    std::string domain = get_entity_domain(entity_id);
    ServiceCall call{domain, "turn_off", entity_id, json::object()};
    call_service(call);
}

void Client::send_notification(const NotificationPayload& notification) {
    request("POST", "/api/notifications/send", notification.to_json());
}

std::vector<json> Client::get_notifications() {
    return request("GET", "/api/notifications");
}

void Client::set_storage(const std::string& key, const json& value) {
    request("PUT", "/api/storage/" + key, value);
}

json Client::get_storage(const std::string& key) {
    return request("GET", "/api/storage/" + key);
}

void Client::delete_storage(const std::string& key) {
    request("DELETE", "/api/storage/" + key);
}

AppSettings Client::get_settings(const std::string& app_id) {
    json response = request("GET", "/api/appstore/apps/" + app_id + "/settings");
    return AppSettings::from_json(response);
}

void Client::update_settings(const std::string& app_id, const json& settings) {
    json body = {
        {"app_id", app_id},
        {"settings", settings}
    };
    request("POST", "/api/appstore/settings", body);
}

std::string Client::get_entity_domain(const std::string& entity_id) {
    size_t pos = entity_id.find('.');
    if (pos != std::string::npos) {
        return entity_id.substr(0, pos);
    }
    return "";
}

} // namespace ora
