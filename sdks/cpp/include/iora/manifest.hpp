#pragma once

#include <string>
#include <vector>
#include <map>
#include <optional>
#include <nlohmann/json.hpp>
#include "permissions.hpp"

namespace iora {

using json = nlohmann::json;

/**
 * Plugin type
 */
enum class PluginType {
    WIDGET,
    SERVICE,
    API,
    INTEGRATION,
    THEME,
    AUTOMATION,
    DATA_PROCESSOR
};

/**
 * App manifest structure
 */
struct AppManifest {
    std::string id;
    std::string name;
    std::string version;
    std::string developer;
    std::string description;
    std::string type;  // "app" or "plugin"
    std::optional<PluginType> plugin_type;
    std::vector<Permission> permissions;
    std::optional<std::string> icon;
    json docker;
    json sandbox;
    json endpoints;
    json widgets;
    json custom_pages;
    json settings_schema;
    json network_access;
    json store_metadata;

    json to_json() const;
};

/**
 * Manifest Builder for creating app manifests programmatically
 */
class ManifestBuilder {
public:
    ManifestBuilder(const std::string& id, const std::string& name);

    ManifestBuilder& version(const std::string& version);
    ManifestBuilder& developer(const std::string& developer);
    ManifestBuilder& description(const std::string& description);
    ManifestBuilder& plugin(PluginType plugin_type);
    ManifestBuilder& permission(Permission permission);
    ManifestBuilder& permissions(const std::vector<Permission>& permissions);
    ManifestBuilder& docker(const json& config);
    ManifestBuilder& sandbox(const json& config);
    ManifestBuilder& custom_page(const json& page);
    ManifestBuilder& widget(const json& widget);
    ManifestBuilder& endpoint(const json& endpoint);
    ManifestBuilder& network_access(const json& config);
    ManifestBuilder& settings_schema(const json& schema);
    ManifestBuilder& store_metadata(const json& metadata);

    AppManifest build() const;
    std::string to_json(int indent = 2) const;
    void save(const std::string& filename = "manifest.json") const;

private:
    AppManifest manifest_;
};

} // namespace iora
