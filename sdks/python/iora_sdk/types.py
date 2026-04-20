"""
Type definitions for IORA SDK
"""

from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, Field
from datetime import datetime


class Entity(BaseModel):
    """Represents a smart home entity"""

    entity_id: str
    state: str
    attributes: Dict[str, Any] = Field(default_factory=dict)
    last_changed: Optional[datetime] = None
    last_updated: Optional[datetime] = None


class ServiceCall(BaseModel):
    """Represents a service call to control an entity"""

    domain: str
    service: str
    entity_id: str
    service_data: Dict[str, Any] = Field(default_factory=dict)


class NotificationAction(BaseModel):
    """Notification action button"""

    action: str
    title: str


class NotificationPayload(BaseModel):
    """Notification payload"""

    title: str
    message: str
    priority: Literal["low", "normal", "high", "critical"] = "normal"
    icon: Optional[str] = None
    actions: List[NotificationAction] = Field(default_factory=list)


class AppSettings(BaseModel):
    """App settings"""

    app_id: str
    settings: Dict[str, Any] = Field(default_factory=dict)


class HealthStatus(BaseModel):
    """Health check status"""

    healthy: bool
    message: Optional[str] = None
    details: Dict[str, Any] = Field(default_factory=dict)


class IoraEvent(BaseModel):
    """IORA event"""

    type: str
    data: Any
    timestamp: int


class IframeMessage(BaseModel):
    """Iframe communication message"""

    type: Literal["request", "response", "event"]
    id: Optional[str] = None
    method: Optional[str] = None
    params: Optional[List[Any]] = None
    result: Optional[Any] = None
    error: Optional[Dict[str, Any]] = None
    event: Optional[IoraEvent] = None
