"""
App Manifest Builder and Types
"""

import json
from typing import Any, Dict, List, Literal, Optional
from enum import Enum
from pydantic import BaseModel, Field
from iora_sdk.permissions import Permission


class PluginType(str, Enum):
    """Plugin type"""

    WIDGET = "widget"
    SERVICE = "service"
    API = "api"
    INTEGRATION = "integration"
    THEME = "theme"
    AUTOMATION = "automation"
    DATA_PROCESSOR = "data_processor"


class PortConfig(BaseModel):
    """Docker port configuration"""

    port: int
    protocol: Literal["tcp", "udp"] = "tcp"
    assignment_mode: Literal["random", "fixed"] = "random"
    description: str


class HealthCheck(BaseModel):
    """Docker health check configuration"""

    endpoint: str
    interval: int
    timeout: int
    retries: int


class DockerConfig(BaseModel):
    """Docker configuration"""

    auto_build: bool = True
    base_image: str
    working_dir: str
    install_cmd: str
    start_cmd: str
    internal_ports: List[PortConfig] = Field(default_factory=list)
    environment: Dict[str, str] = Field(default_factory=dict)
    volumes: List[str] = Field(default_factory=list)
    health_check: Optional[HealthCheck] = None


class SandboxConfig(BaseModel):
    """Sandbox configuration for plugins"""

    max_execution_time_ms: int
    max_memory_mb: int
    allow_network: bool
    allow_file_system: bool


class ApiEndpoint(BaseModel):
    """API endpoint definition"""

    path: str
    method: str
    description: str


class WidgetDefinition(BaseModel):
    """Widget definition"""

    id: str
    name: str
    type: str
    component_url: str
    description: str
    default_config: Optional[Dict[str, Any]] = None


class IframeConfig(BaseModel):
    """Iframe security configuration"""

    sandbox: List[str] = Field(default_factory=list)
    allow: List[str] = Field(default_factory=list)
    security_token: bool = True


class CustomPage(BaseModel):
    """Custom page definition"""

    id: str
    title: str
    icon: str
    url: str
    show_in_nav: bool = True
    order: Optional[int] = None
    parent_page_id: Optional[str] = None
    iframe: bool = False
    iframe_config: Optional[IframeConfig] = None


class FieldValidation(BaseModel):
    """Settings field validation"""

    min: Optional[int] = None
    max: Optional[int] = None
    min_length: Optional[int] = None
    max_length: Optional[int] = None
    pattern: Optional[str] = None


class SelectOption(BaseModel):
    """Select field option"""

    value: str
    label: str


class SettingsField(BaseModel):
    """Settings field definition"""

    key: str
    label: str
    type: Literal[
        "text", "password", "number", "boolean", "select", "textarea", "url", "email", "color"
    ]
    default: Optional[Any] = None
    required: bool = False
    validation: Optional[FieldValidation] = None
    options: Optional[List[SelectOption]] = None


class SettingsSchema(BaseModel):
    """Settings schema"""

    title: str
    description: str
    fields: List[SettingsField]


class NetworkAccessConfig(BaseModel):
    """Network access configuration"""

    allowed_domains: Optional[List[str]] = None
    allow_user_domains: bool = False
    allowed_local_ips: Optional[List[str]] = None
    allow_user_local_ips: bool = False
    allow_network_scan: bool = False


class StoreMetadata(BaseModel):
    """App store metadata"""

    category: str
    tags: List[str] = Field(default_factory=list)
    screenshots: List[str] = Field(default_factory=list)
    homepage: Optional[str] = None


class AppManifest(BaseModel):
    """Complete app manifest"""

    id: str
    name: str
    version: str
    developer: str
    description: str
    type: Literal["app", "plugin"] = "app"
    plugin_type: Optional[PluginType] = None
    permissions: List[Permission] = Field(default_factory=list)
    icon: Optional[str] = None
    docker: Optional[DockerConfig] = None
    sandbox: Optional[SandboxConfig] = None
    endpoints: List[ApiEndpoint] = Field(default_factory=list)
    widgets: List[WidgetDefinition] = Field(default_factory=list)
    custom_pages: List[CustomPage] = Field(default_factory=list)
    settings_schema: Optional[SettingsSchema] = None
    network_access: Optional[NetworkAccessConfig] = None
    store_metadata: Optional[StoreMetadata] = None


class ManifestBuilder:
    """
    Manifest Builder for creating app manifests programmatically
    """

    def __init__(self, id: str, name: str):
        """
        Initialize manifest builder

        Args:
            id: App ID
            name: App name
        """
        self.manifest = AppManifest(
            id=id,
            name=name,
            version="1.0.0",
            developer="",
            description="",
            type="app",
        )

    def version(self, version: str) -> "ManifestBuilder":
        """Set version"""
        self.manifest.version = version
        return self

    def developer(self, developer: str) -> "ManifestBuilder":
        """Set developer"""
        self.manifest.developer = developer
        return self

    def description(self, description: str) -> "ManifestBuilder":
        """Set description"""
        self.manifest.description = description
        return self

    def plugin(self, plugin_type: PluginType) -> "ManifestBuilder":
        """Set as plugin with type"""
        self.manifest.type = "plugin"
        self.manifest.plugin_type = plugin_type
        return self

    def permission(self, permission: Permission) -> "ManifestBuilder":
        """Add a permission"""
        self.manifest.permissions.append(permission)
        return self

    def permissions(self, permissions: List[Permission]) -> "ManifestBuilder":
        """Set permissions"""
        self.manifest.permissions = permissions
        return self

    def docker(self, config: DockerConfig) -> "ManifestBuilder":
        """Set Docker configuration"""
        self.manifest.docker = config
        return self

    def sandbox(self, config: SandboxConfig) -> "ManifestBuilder":
        """Set sandbox configuration"""
        self.manifest.sandbox = config
        return self

    def custom_page(self, page: CustomPage) -> "ManifestBuilder":
        """Add a custom page"""
        self.manifest.custom_pages.append(page)
        return self

    def widget(self, widget: WidgetDefinition) -> "ManifestBuilder":
        """Add a widget"""
        self.manifest.widgets.append(widget)
        return self

    def endpoint(self, endpoint: ApiEndpoint) -> "ManifestBuilder":
        """Add an API endpoint"""
        self.manifest.endpoints.append(endpoint)
        return self

    def network_access(self, config: NetworkAccessConfig) -> "ManifestBuilder":
        """Set network access configuration"""
        self.manifest.network_access = config
        return self

    def settings_schema(self, schema: SettingsSchema) -> "ManifestBuilder":
        """Set settings schema"""
        self.manifest.settings_schema = schema
        return self

    def store_metadata(self, metadata: StoreMetadata) -> "ManifestBuilder":
        """Set store metadata"""
        self.manifest.store_metadata = metadata
        return self

    def build(self) -> AppManifest:
        """Build and return the manifest"""
        if not self.manifest.id or not self.manifest.name:
            raise ValueError("id and name are required")
        return self.manifest

    def to_json(self, indent: int = 2) -> str:
        """Export manifest as JSON string"""
        return self.build().model_dump_json(indent=indent, exclude_none=True)

    def save(self, filename: str = "manifest.json") -> None:
        """Save manifest to file"""
        with open(filename, "w") as f:
            f.write(self.to_json())
