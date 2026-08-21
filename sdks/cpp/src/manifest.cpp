#include "ora/manifest.hpp"
#include <fstream>
#include <stdexcept>

namespace ora {

ManifestBuilder::ManifestBuilder(const std::string& id, const std::string& name) {
    manifest_.id = id;
    manifest_.name = name;
    manifest_.version = "1.0.0";
    manifest_.developer = "";
    manifest_.description = "";
    manifest_.type = "app";
    manifest_.custom_pages = json::array();
    manifest_.widgets = json::array();
    manifest_.endpoints = json::array();
}

ManifestBuilder& ManifestBuilder::version(const std::string& version) {
    manifest_.version = version;
    return *this;
}

ManifestBuilder& ManifestBuilder::developer(const std::string& developer) {
    manifest_.developer = developer;
    return *this;
}

ManifestBuilder& ManifestBuilder::description(const std::string& description) {
    manifest_.description = description;
    return *this;
}

ManifestBuilder& ManifestBuilder::plugin(PluginType plugin_type) {
    manifest_.type = "plugin";
    manifest_.plugin_type = plugin_type;
    return *this;
}

ManifestBuilder& ManifestBuilder::permission(Permission permission) {
    manifest_.permissions.push_back(permission);
    return *this;
}

ManifestBuilder& ManifestBuilder::permissions(const std::vector<Permission>& permissions) {
    manifest_.permissions = permissions;
    return *this;
}

ManifestBuilder& ManifestBuilder::docker(const json& config) {
    manifest_.docker = config;
    return *this;
}

ManifestBuilder& ManifestBuilder::sandbox(const json& config) {
    manifest_.sandbox = config;
    return *this;
}

ManifestBuilder& ManifestBuilder::custom_page(const json& page) {
    if (!manifest_.custom_pages.is_array()) {
        manifest_.custom_pages = json::array();
    }
    manifest_.custom_pages.push_back(page);
    return *this;
}

ManifestBuilder& ManifestBuilder::widget(const json& widget) {
    if (!manifest_.widgets.is_array()) {
        manifest_.widgets = json::array();
    }
    manifest_.widgets.push_back(widget);
    return *this;
}

ManifestBuilder& ManifestBuilder::endpoint(const json& endpoint) {
    if (!manifest_.endpoints.is_array()) {
        manifest_.endpoints = json::array();
    }
    manifest_.endpoints.push_back(endpoint);
    return *this;
}

ManifestBuilder& ManifestBuilder::network_access(const json& config) {
    manifest_.network_access = config;
    return *this;
}

ManifestBuilder& ManifestBuilder::settings_schema(const json& schema) {
    manifest_.settings_schema = schema;
    return *this;
}

ManifestBuilder& ManifestBuilder::store_metadata(const json& metadata) {
    manifest_.store_metadata = metadata;
    return *this;
}

AppManifest ManifestBuilder::build() const {
    if (manifest_.id.empty() || manifest_.name.empty()) {
        throw std::runtime_error("id and name are required");
    }
    return manifest_;
}

std::string ManifestBuilder::to_json(int indent) const {
    return build().to_json().dump(indent);
}

void ManifestBuilder::save(const std::string& filename) const {
    std::ofstream file(filename);
    if (!file.is_open()) {
        throw std::runtime_error("Failed to open file: " + filename);
    }
    file << to_json();
    file.close();
}

json AppManifest::to_json() const {
    json j = {
        {"id", id},
        {"name", name},
        {"version", version},
        {"developer", developer},
        {"description", description},
        {"type", type}
    };

    if (!permissions.empty()) {
        json perms_array = json::array();
        for (const auto& perm : permissions) {
            perms_array.push_back(permission_to_string(perm));
        }
        j["permissions"] = perms_array;
    }

    if (icon) {
        j["icon"] = *icon;
    }

    if (!docker.is_null()) {
        j["docker"] = docker;
    }

    if (!sandbox.is_null()) {
        j["sandbox"] = sandbox;
    }

    if (!endpoints.empty()) {
        j["endpoints"] = endpoints;
    }

    if (!widgets.empty()) {
        j["widgets"] = widgets;
    }

    if (!custom_pages.empty()) {
        j["custom_pages"] = custom_pages;
    }

    if (!settings_schema.is_null()) {
        j["settings_schema"] = settings_schema;
    }

    if (!network_access.is_null()) {
        j["network_access"] = network_access;
    }

    if (!store_metadata.is_null()) {
        j["store_metadata"] = store_metadata;
    }

    return j;
}

} // namespace ora
