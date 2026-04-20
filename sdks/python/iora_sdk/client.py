"""
HTTP client for IORA API
"""

import httpx
from typing import Any, Dict, List, Optional
from iora_sdk.types import Entity, ServiceCall, NotificationPayload, AppSettings


class IoraClient:
    """
    IORA API Client

    HTTP client for interacting with IORA APIs
    """

    def __init__(self, base_url: str = "http://localhost:8080", api_key: Optional[str] = None):
        """
        Initialize IORA client

        Args:
            base_url: Base URL of IORA instance
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

    async def __aenter__(self) -> "IoraClient":
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
