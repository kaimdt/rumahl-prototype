"""
HTTP client for rumahl API
"""

import httpx
import base64
from typing import Any, Dict, List, Optional
from rumahl_sdk.types import (
    Entity,
    ServiceCall,
    NotificationPayload,
    AppSettings,
    FileMetadata,
    FileUpload,
    FilePermissions,
    Automation,
)


class rumahlClient:
    """
    rumahl API Client

    HTTP client for interacting with rumahl APIs
    """

    def __init__(self, base_url: str = "http://localhost:8080", api_key: Optional[str] = None):
        """
        Initialize rumahl client

        Args:
            base_url: Base URL of rumahl instance
            api_key: API key for authentication
        """
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self._client = httpx.AsyncClient(timeout=30.0)

    def set_api_key(self, api_key: str) -> None:
        """Set API key for authentication"""
        self.api_key = api_key

    def _get_headers(self) -> Dict[str, str]:
        """Get request headers with authentication"""
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    async def _request(
        self, method: str, path: str, json: Optional[Dict[str, Any]] = None
    ) -> Any:
        """Make an authenticated request"""
        url = f"{self.base_url}{path}"
        headers = self._get_headers()

        response = await self._client.request(method, url, json=json, headers=headers)
        response.raise_for_status()

        return response.json()

    async def close(self) -> None:
        """Close the HTTP client"""
        await self._client.aclose()

    async def __aenter__(self) -> "rumahlClient":
        return self

    async def __aexit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        await self.close()

    # Entity API
    async def get_entities(self) -> List[Entity]:
        """Get all entities"""
        data = await self._request("GET", "/api/states")
        return [Entity(**entity) for entity in data]

    async def get_entity(self, entity_id: str) -> Entity:
        """Get a specific entity"""
        data = await self._request("GET", f"/api/states/{entity_id}")
        return Entity(**data)

    async def call_service(self, call: ServiceCall) -> Any:
        """Call a service on an entity"""
        return await self._request(
            "POST",
            f"/api/services/{call.domain}/{call.service}",
            json={"entity_id": call.entity_id, "service_data": call.service_data},
        )

    async def turn_on(self, entity_id: str, data: Optional[Dict[str, Any]] = None) -> Any:
        """Turn on a device"""
        domain = entity_id.split(".")[0]
        call = ServiceCall(
            domain=domain,
            service="turn_on",
            entity_id=entity_id,
            service_data=data or {},
        )
        return await self.call_service(call)

    async def turn_off(self, entity_id: str) -> Any:
        """Turn off a device"""
        domain = entity_id.split(".")[0]
        call = ServiceCall(
            domain=domain, service="turn_off", entity_id=entity_id, service_data={}
        )
        return await self.call_service(call)

    # Notifications API
    async def send_notification(self, notification: NotificationPayload) -> Any:
        """Send a notification"""
        return await self._request(
            "POST", "/api/notifications/send", json=notification.model_dump()
        )

    async def get_notifications(self) -> List[Dict[str, Any]]:
        """Get all notifications"""
        return await self._request("GET", "/api/notifications")

    # Storage API
    async def set_storage(self, key: str, value: Any) -> Any:
        """Store a value"""
        return await self._request("PUT", f"/api/storage/{key}", json=value)

    async def get_storage(self, key: str) -> Any:
        """Get a stored value"""
        return await self._request("GET", f"/api/storage/{key}")

    async def delete_storage(self, key: str) -> Any:
        """Delete a stored value"""
        return await self._request("DELETE", f"/api/storage/{key}")

    # Settings API
    async def get_settings(self, app_id: str) -> AppSettings:
        """Get app settings"""
        data = await self._request("GET", f"/api/appstore/apps/{app_id}/settings")
        return AppSettings(**data)

    async def update_settings(self, app_id: str, settings: Dict[str, Any]) -> Any:
        """Update app settings"""
        return await self._request(
            "POST", "/api/appstore/settings", json={"app_id": app_id, "settings": settings}
        )

    # Files API (rumahl-share)
    async def list_files(self, path: Optional[str] = None) -> List[FileMetadata]:
        """
        List all files accessible to the app
        Requires: FileShareRead permission
        """
        path_param = path or "/"
        data = await self._request("GET", f"/api/files?path={path_param}")
        return [FileMetadata(**file) for file in data]

    async def get_file_metadata(self, file_id: str) -> FileMetadata:
        """
        Get file metadata
        Requires: FileShareRead permission
        """
        data = await self._request("GET", f"/api/files/{file_id}/metadata")
        return FileMetadata(**data)

    async def download_file(self, file_id: str) -> bytes:
        """
        Download a file
        Requires: FileShareRead permission
        """
        url = f"{self.base_url}/api/files/{file_id}/download"
        headers = self._get_headers()
        response = await self._client.get(url, headers=headers)
        response.raise_for_status()
        return response.content

    async def upload_file(self, upload: FileUpload) -> FileMetadata:
        """
        Upload a file
        Requires: FileShareWrite permission
        """
        content_b64 = base64.b64encode(upload.content).decode("utf-8")
        data = await self._request(
            "POST",
            "/api/files/upload",
            json={
                "name": upload.name,
                "path": upload.path,
                "content": content_b64,
                "mime_type": upload.mime_type,
            },
        )
        return FileMetadata(**data)

    async def delete_file(self, file_id: str) -> Any:
        """
        Delete a file
        Requires: FileShareDelete permission
        """
        return await self._request("DELETE", f"/api/files/{file_id}")

    async def share_file(
        self, file_id: str, share_with: List[str], permissions: FilePermissions
    ) -> Any:
        """
        Share a file with other users or apps
        Requires: FileShareManage permission
        """
        return await self._request(
            "POST",
            f"/api/files/{file_id}/share",
            json={"share_with": share_with, "permissions": permissions.model_dump()},
        )

    async def update_file_permissions(
        self, file_id: str, user_or_app: str, permissions: FilePermissions
    ) -> Any:
        """
        Update file permissions for a share
        Requires: FileShareManage permission
        """
        return await self._request(
            "PUT",
            f"/api/files/{file_id}/permissions",
            json={"user_or_app": user_or_app, "permissions": permissions.model_dump()},
        )

    # Automations API
    async def list_automations(self) -> List[Automation]:
        """
        List all automations
        Requires: Automations permission (App-only)
        """
        data = await self._request("GET", "/api/automations")
        return [Automation(**automation) for automation in data]

    async def get_automation(self, automation_id: str) -> Automation:
        """
        Get a specific automation
        Requires: Automations permission (App-only)
        """
        data = await self._request("GET", f"/api/automations/{automation_id}")
        return Automation(**data)

    async def create_automation(self, automation: Automation) -> Automation:
        """
        Create a new automation
        Requires: Automations permission (App-only)
        """
        data = await self._request(
            "POST", "/api/automations", json=automation.model_dump()
        )
        return Automation(**data)

    async def update_automation(
        self, automation_id: str, automation: Automation
    ) -> Automation:
        """
        Update an existing automation
        Requires: Automations permission (App-only)
        """
        data = await self._request(
            "PUT", f"/api/automations/{automation_id}", json=automation.model_dump()
        )
        return Automation(**data)

    async def delete_automation(self, automation_id: str) -> Any:
        """
        Delete an automation
        Requires: Automations permission (App-only)
        """
        return await self._request("DELETE", f"/api/automations/{automation_id}")

    async def set_automation_enabled(self, automation_id: str, enabled: bool) -> Any:
        """
        Enable/disable an automation
        Requires: Automations permission (App-only)
        """
        return await self._request(
            "PUT", f"/api/automations/{automation_id}/enabled", json={"enabled": enabled}
        )

    async def trigger_automation(self, automation_id: str) -> Any:
        """
        Trigger an automation manually
        Requires: Automations permission (App-only)
        """
        return await self._request("POST", f"/api/automations/{automation_id}/trigger")

    # Developer Mode API
    async def get_developer_mode_status(self) -> Dict[str, Any]:
        """
        Get Developer Mode status
        """
        return await self._request("GET", "/api/developer/status")

    async def toggle_developer_mode(self, enabled: bool) -> Dict[str, Any]:
        """
        Toggle Developer Mode on/off
        Requires: Admin access
        """
        return await self._request("POST", "/api/developer/toggle", json={"enabled": enabled})

    async def list_apps_detailed(self) -> List[Dict[str, Any]]:
        """
        List all apps with detailed information including resource usage
        Requires: DeveloperAccess permission, Developer Mode enabled
        """
        data = await self._request("GET", "/api/developer/apps")
        return data["apps"]

    async def call_app(
        self, target_app_id: str, method: str, endpoint: str, body: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Call another app's API endpoint
        Requires: InterAppCommunication permission, Developer Mode enabled

        Args:
            target_app_id: ID of the target app
            method: HTTP method (GET, POST, PUT, DELETE)
            endpoint: API endpoint path
            body: Optional request body for POST/PUT
        """
        return await self._request(
            "POST",
            "/api/developer/apps/call",
            json={
                "target_app_id": target_app_id,
                "method": method,
                "endpoint": endpoint,
                "body": body,
            },
        )

    async def get_live_metrics(self) -> Dict[str, Any]:
        """
        Get live system metrics
        Requires: LiveMetrics permission, Developer Mode enabled
        """
        return await self._request("GET", "/api/developer/metrics")

    async def deploy_from_ide(self, app_id: str, image_tar: str, restart: bool = True) -> Dict[str, Any]:
        """
        Deploy/update app from IDE
        Requires: DirectDeploy permission, Developer Mode enabled

        Args:
            app_id: App ID to deploy
            image_tar: Base64 encoded tar archive of Docker image
            restart: Whether to restart the container after deployment
        """
        return await self._request(
            "POST",
            "/api/developer/deploy",
            json={"app_id": app_id, "image_tar": image_tar, "restart": restart},
        )

    async def stream_logs(self, container_name: str):
        """
        Stream live logs from a container (Server-Sent Events)
        Requires: LiveLogs permission, Developer Mode enabled

        Note: This returns an async iterator. Use:
            async for log_line in client.stream_logs("container-name"):
                print(log_line)
        """
        url = f"{self.base_url}/api/developer/logs/{container_name}/stream"
        headers = self._get_headers()
        headers["Accept"] = "text/event-stream"

        async with self._client.stream("GET", url, headers=headers) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if line.startswith("data: "):
                    yield line[6:]  # Remove "data: " prefix

    async def stream_metrics(self):
        """
        Stream live metrics (Server-Sent Events)
        Requires: LiveMetrics permission, Developer Mode enabled

        Note: This returns an async iterator. Use:
            async for metrics in client.stream_metrics():
                print(metrics)
        """
        url = f"{self.base_url}/api/developer/metrics/stream"
        headers = self._get_headers()
        headers["Accept"] = "text/event-stream"

        async with self._client.stream("GET", url, headers=headers) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if line.startswith("data: "):
                    yield line[6:]  # Remove "data: " prefix

    # Developer App - Hot Reload APIs
    # These methods interact with the rumahl Developer App (io.rumahl.developer-app)
    # which provides exclusive hot-reload capabilities

    async def hotreload_upload(
        self, app_id: str, version: str, package_data: str, description: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Upload app package for hot reload
        Requires: HotReload permission (exclusive to Developer App), Developer Mode enabled

        Args:
            app_id: ID of the app to update
            version: Version identifier for this update
            package_data: Base64 encoded package data
            description: Optional description of changes
        """
        payload = {
            "app_id": app_id,
            "version": version,
            "package_data": package_data,
        }
        if description:
            payload["description"] = description

        return await self._request("POST", "/api/hotreload/upload", json=payload)

    async def hotreload_status(self, app_id: str) -> Dict[str, Any]:
        """
        Get hot reload status for an app
        Requires: HotReload permission, Developer Mode enabled

        Args:
            app_id: ID of the app to check
        """
        return await self._request("GET", f"/api/hotreload/status/{app_id}")

    async def hotreload_rollback(self, app_id: str, version: str) -> Dict[str, Any]:
        """
        Rollback app to a previous version
        Requires: HotReload permission, Developer Mode enabled

        Args:
            app_id: ID of the app to rollback
            version: Version to rollback to
        """
        return await self._request("POST", f"/api/hotreload/rollback/{app_id}", json={"version": version})

    async def hotreload_history(self, app_id: str) -> List[Dict[str, Any]]:
        """
        Get hot reload history for an app
        Requires: HotReload permission, Developer Mode enabled

        Args:
            app_id: ID of the app
        """
        data = await self._request("GET", f"/api/hotreload/history/{app_id}")
        return data.get("history", [])

