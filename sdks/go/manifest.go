// Package ora provides manifest builder and types
package ora

import (
	"encoding/json"
	"fmt"
	"os"
)

// PluginType represents the type of plugin
type PluginType string

const (
	PluginTypeWidget        PluginType = "widget"
	PluginTypeService       PluginType = "service"
	PluginTypeAPI           PluginType = "api"
	PluginTypeIntegration   PluginType = "integration"
	PluginTypeTheme         PluginType = "theme"
	PluginTypeAutomation    PluginType = "automation"
	PluginTypeDataProcessor PluginType = "data_processor"
)

// PortConfig represents Docker port configuration
type PortConfig struct {
	Port           int    `json:"port"`
	Protocol       string `json:"protocol"` // tcp, udp
	AssignmentMode string `json:"assignment_mode"` // random, fixed
	Description    string `json:"description"`
}

// HealthCheck represents Docker health check configuration
type HealthCheck struct {
	Endpoint string `json:"endpoint"`
	Interval int    `json:"interval"`
	Timeout  int    `json:"timeout"`
	Retries  int    `json:"retries"`
}

// DockerConfig represents Docker configuration
type DockerConfig struct {
	AutoBuild     bool                   `json:"auto_build"`
	BaseImage     string                 `json:"base_image"`
	WorkingDir    string                 `json:"working_dir"`
	InstallCmd    string                 `json:"install_cmd"`
	StartCmd      string                 `json:"start_cmd"`
	InternalPorts []PortConfig           `json:"internal_ports,omitempty"`
	Environment   map[string]string      `json:"environment,omitempty"`
	Volumes       []string               `json:"volumes,omitempty"`
	HealthCheck   *HealthCheck           `json:"health_check,omitempty"`
}

// SandboxConfig represents sandbox configuration for plugins
type SandboxConfig struct {
	MaxExecutionTimeMS int  `json:"max_execution_time_ms"`
	MaxMemoryMB        int  `json:"max_memory_mb"`
	AllowNetwork       bool `json:"allow_network"`
	AllowFileSystem    bool `json:"allow_file_system"`
}

// APIEndpoint represents an API endpoint definition
type APIEndpoint struct {
	Path        string `json:"path"`
	Method      string `json:"method"`
	Description string `json:"description"`
}

// WidgetDefinition represents a widget definition
type WidgetDefinition struct {
	ID           string                 `json:"id"`
	Name         string                 `json:"name"`
	Type         string                 `json:"type"`
	ComponentURL string                 `json:"component_url"`
	Description  string                 `json:"description"`
	DefaultConfig map[string]interface{} `json:"default_config,omitempty"`
}

// IframeConfig represents iframe security configuration
type IframeConfig struct {
	Sandbox       []string `json:"sandbox"`
	Allow         []string `json:"allow"`
	SecurityToken bool     `json:"security_token"`
}

// CustomPage represents a custom page definition
type CustomPage struct {
	ID           string        `json:"id"`
	Title        string        `json:"title"`
	Icon         string        `json:"icon"`
	URL          string        `json:"url"`
	ShowInNav    bool          `json:"show_in_nav"`
	Order        *int          `json:"order,omitempty"`
	ParentPageID *string       `json:"parent_page_id,omitempty"`
	Iframe       bool          `json:"iframe"`
	IframeConfig *IframeConfig `json:"iframe_config,omitempty"`
}

// FieldValidation represents settings field validation
type FieldValidation struct {
	Min       *int   `json:"min,omitempty"`
	Max       *int   `json:"max,omitempty"`
	MinLength *int   `json:"min_length,omitempty"`
	MaxLength *int   `json:"max_length,omitempty"`
	Pattern   string `json:"pattern,omitempty"`
}

// SelectOption represents a select field option
type SelectOption struct {
	Value string `json:"value"`
	Label string `json:"label"`
}

// SettingsField represents a settings field definition
type SettingsField struct {
	Key        string           `json:"key"`
	Label      string           `json:"label"`
	Type       string           `json:"type"` // text, password, number, boolean, select, textarea, url, email, color
	Default    interface{}      `json:"default,omitempty"`
	Required   bool             `json:"required,omitempty"`
	Validation *FieldValidation `json:"validation,omitempty"`
	Options    []SelectOption   `json:"options,omitempty"`
}

// SettingsSchema represents settings schema
type SettingsSchema struct {
	Title       string          `json:"title"`
	Description string          `json:"description"`
	Fields      []SettingsField `json:"fields"`
}

// NetworkAccessConfig represents network access configuration
type NetworkAccessConfig struct {
	AllowedDomains      []string `json:"allowed_domains,omitempty"`
	AllowUserDomains    bool     `json:"allow_user_domains,omitempty"`
	AllowedLocalIPs     []string `json:"allowed_local_ips,omitempty"`
	AllowUserLocalIPs   bool     `json:"allow_user_local_ips,omitempty"`
	AllowNetworkScan    bool     `json:"allow_network_scan,omitempty"`
}

// StoreMetadata represents app store metadata
type StoreMetadata struct {
	Category    string   `json:"category"`
	Tags        []string `json:"tags,omitempty"`
	Screenshots []string `json:"screenshots,omitempty"`
	Homepage    string   `json:"homepage,omitempty"`
}

// AppManifest represents a complete app manifest
type AppManifest struct {
	ID            string                `json:"id"`
	Name          string                `json:"name"`
	Version       string                `json:"version"`
	Developer     string                `json:"developer"`
	Description   string                `json:"description"`
	Type          string                `json:"type"` // app, plugin
	PluginType    *PluginType           `json:"plugin_type,omitempty"`
	Permissions   []Permission          `json:"permissions,omitempty"`
	Icon          string                `json:"icon,omitempty"`
	Docker        *DockerConfig         `json:"docker,omitempty"`
	Sandbox       *SandboxConfig        `json:"sandbox,omitempty"`
	Endpoints     []APIEndpoint         `json:"endpoints,omitempty"`
	Widgets       []WidgetDefinition    `json:"widgets,omitempty"`
	CustomPages   []CustomPage          `json:"custom_pages,omitempty"`
	SettingsSchema *SettingsSchema      `json:"settings_schema,omitempty"`
	NetworkAccess *NetworkAccessConfig  `json:"network_access,omitempty"`
	StoreMetadata *StoreMetadata        `json:"store_metadata,omitempty"`
}

// ManifestBuilder helps build app manifests programmatically
type ManifestBuilder struct {
	manifest AppManifest
}

// NewManifestBuilder creates a new manifest builder
func NewManifestBuilder(id, name string) *ManifestBuilder {
	return &ManifestBuilder{
		manifest: AppManifest{
			ID:          id,
			Name:        name,
			Version:     "1.0.0",
			Developer:   "",
			Description: "",
			Type:        "app",
			Permissions: []Permission{},
			CustomPages: []CustomPage{},
			Widgets:     []WidgetDefinition{},
			Endpoints:   []APIEndpoint{},
		},
	}
}

// Version sets the version
func (mb *ManifestBuilder) Version(version string) *ManifestBuilder {
	mb.manifest.Version = version
	return mb
}

// Developer sets the developer
func (mb *ManifestBuilder) Developer(developer string) *ManifestBuilder {
	mb.manifest.Developer = developer
	return mb
}

// Description sets the description
func (mb *ManifestBuilder) Description(description string) *ManifestBuilder {
	mb.manifest.Description = description
	return mb
}

// Plugin sets the manifest as a plugin with the given type
func (mb *ManifestBuilder) Plugin(pluginType PluginType) *ManifestBuilder {
	mb.manifest.Type = "plugin"
	mb.manifest.PluginType = &pluginType
	return mb
}

// Permission adds a permission
func (mb *ManifestBuilder) Permission(permission Permission) *ManifestBuilder {
	mb.manifest.Permissions = append(mb.manifest.Permissions, permission)
	return mb
}

// Permissions sets permissions
func (mb *ManifestBuilder) Permissions(permissions []Permission) *ManifestBuilder {
	mb.manifest.Permissions = permissions
	return mb
}

// Docker sets Docker configuration
func (mb *ManifestBuilder) Docker(config DockerConfig) *ManifestBuilder {
	mb.manifest.Docker = &config
	return mb
}

// Sandbox sets sandbox configuration
func (mb *ManifestBuilder) Sandbox(config SandboxConfig) *ManifestBuilder {
	mb.manifest.Sandbox = &config
	return mb
}

// CustomPage adds a custom page
func (mb *ManifestBuilder) CustomPage(page CustomPage) *ManifestBuilder {
	mb.manifest.CustomPages = append(mb.manifest.CustomPages, page)
	return mb
}

// Widget adds a widget
func (mb *ManifestBuilder) Widget(widget WidgetDefinition) *ManifestBuilder {
	mb.manifest.Widgets = append(mb.manifest.Widgets, widget)
	return mb
}

// Endpoint adds an API endpoint
func (mb *ManifestBuilder) Endpoint(endpoint APIEndpoint) *ManifestBuilder {
	mb.manifest.Endpoints = append(mb.manifest.Endpoints, endpoint)
	return mb
}

// NetworkAccess sets network access configuration
func (mb *ManifestBuilder) NetworkAccess(config NetworkAccessConfig) *ManifestBuilder {
	mb.manifest.NetworkAccess = &config
	return mb
}

// SettingsSchema sets settings schema
func (mb *ManifestBuilder) SettingsSchema(schema SettingsSchema) *ManifestBuilder {
	mb.manifest.SettingsSchema = &schema
	return mb
}

// StoreMetadata sets store metadata
func (mb *ManifestBuilder) StoreMetadata(metadata StoreMetadata) *ManifestBuilder {
	mb.manifest.StoreMetadata = &metadata
	return mb
}

// Build returns the completed manifest
func (mb *ManifestBuilder) Build() (*AppManifest, error) {
	if mb.manifest.ID == "" || mb.manifest.Name == "" {
		return nil, fmt.Errorf("id and name are required")
	}
	return &mb.manifest, nil
}

// ToJSON returns the manifest as JSON string
func (mb *ManifestBuilder) ToJSON() (string, error) {
	manifest, err := mb.Build()
	if err != nil {
		return "", err
	}

	data, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return "", fmt.Errorf("failed to marshal manifest: %w", err)
	}

	return string(data), nil
}

// Save saves the manifest to a file
func (mb *ManifestBuilder) Save(filename string) error {
	jsonStr, err := mb.ToJSON()
	if err != nil {
		return err
	}

	if err := os.WriteFile(filename, []byte(jsonStr), 0644); err != nil {
		return fmt.Errorf("failed to write manifest file: %w", err)
	}

	return nil
}
