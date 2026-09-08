<?php

namespace rumahl;

/**
 * Plugin type
 */
enum PluginType: string
{
    case WIDGET = 'widget';
    case SERVICE = 'service';
    case API = 'api';
    case INTEGRATION = 'integration';
    case THEME = 'theme';
    case AUTOMATION = 'automation';
    case DATA_PROCESSOR = 'data_processor';
}

/**
 * Manifest Builder for creating app manifests programmatically
 */
class ManifestBuilder
{
    private array $manifest;

    public function __construct(string $id, string $name)
    {
        $this->manifest = [
            'id' => $id,
            'name' => $name,
            'version' => '1.0.0',
            'developer' => '',
            'description' => '',
            'type' => 'app',
            'permissions' => [],
            'custom_pages' => [],
            'widgets' => [],
            'endpoints' => [],
        ];
    }

    public function version(string $version): self
    {
        $this->manifest['version'] = $version;
        return $this;
    }

    public function developer(string $developer): self
    {
        $this->manifest['developer'] = $developer;
        return $this;
    }

    public function description(string $description): self
    {
        $this->manifest['description'] = $description;
        return $this;
    }

    public function plugin(PluginType $pluginType): self
    {
        $this->manifest['type'] = 'plugin';
        $this->manifest['plugin_type'] = $pluginType->value;
        return $this;
    }

    public function permission(Permission $permission): self
    {
        $this->manifest['permissions'][] = $permission->value;
        return $this;
    }

    /** @param Permission[] $permissions */
    public function permissions(array $permissions): self
    {
        $this->manifest['permissions'] = array_map(
            fn(Permission $p) => $p->value,
            $permissions
        );
        return $this;
    }

    public function docker(array $config): self
    {
        $this->manifest['docker'] = $config;
        return $this;
    }

    public function sandbox(array $config): self
    {
        $this->manifest['sandbox'] = $config;
        return $this;
    }

    public function customPage(array $page): self
    {
        $this->manifest['custom_pages'][] = $page;
        return $this;
    }

    public function widget(array $widget): self
    {
        $this->manifest['widgets'][] = $widget;
        return $this;
    }

    public function endpoint(array $endpoint): self
    {
        $this->manifest['endpoints'][] = $endpoint;
        return $this;
    }

    public function networkAccess(array $config): self
    {
        $this->manifest['network_access'] = $config;
        return $this;
    }

    public function settingsSchema(array $schema): self
    {
        $this->manifest['settings_schema'] = $schema;
        return $this;
    }

    public function storeMetadata(array $metadata): self
    {
        $this->manifest['store_metadata'] = $metadata;
        return $this;
    }

    public function build(): array
    {
        if (empty($this->manifest['id']) || empty($this->manifest['name'])) {
            throw new \Exception('id and name are required');
        }
        return $this->manifest;
    }

    public function toJson(int $flags = JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES): string
    {
        return json_encode($this->build(), $flags);
    }

    public function save(string $filename = 'manifest.json'): void
    {
        file_put_contents($filename, $this->toJson());
    }
}
