"""
Type definitions for rumahl SDK
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


class rumahlEvent(BaseModel):
    """rumahl event"""

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
    event: Optional[rumahlEvent] = None


class FilePermissions(BaseModel):
    """File permissions for sharing"""

    read: bool
    write: bool
    delete: bool
    share: bool


class FileMetadata(BaseModel):
    """File metadata from rumahl-share"""

    id: str
    name: str
    path: str
    size: int
    mime_type: str
    created_at: str
    modified_at: str
    owner: str
    shared_with: Optional[List[str]] = None
    permissions: Optional[FilePermissions] = None


class FileUpload(BaseModel):
    """File upload request"""

    name: str
    path: str
    content: bytes
    mime_type: Optional[str] = None


class AutomationTriggerState(BaseModel):
    """State trigger for automation"""

    type: Literal["state"] = "state"
    entity_id: str
    from_state: Optional[str] = Field(None, alias="from")
    to_state: Optional[str] = Field(None, alias="to")


class AutomationTriggerTime(BaseModel):
    """Time trigger for automation"""

    type: Literal["time"] = "time"
    at: str


class AutomationTriggerEvent(BaseModel):
    """Event trigger for automation"""

    type: Literal["event"] = "event"
    event_type: str


class AutomationTriggerWebhook(BaseModel):
    """Webhook trigger for automation"""

    type: Literal["webhook"] = "webhook"
    webhook_id: str


AutomationTrigger = AutomationTriggerState | AutomationTriggerTime | AutomationTriggerEvent | AutomationTriggerWebhook


class AutomationConditionState(BaseModel):
    """State condition for automation"""

    type: Literal["state"] = "state"
    entity_id: str
    state: str


class AutomationConditionNumericState(BaseModel):
    """Numeric state condition for automation"""

    type: Literal["numeric_state"] = "numeric_state"
    entity_id: str
    above: Optional[float] = None
    below: Optional[float] = None


class AutomationConditionTime(BaseModel):
    """Time condition for automation"""

    type: Literal["time"] = "time"
    after: Optional[str] = None
    before: Optional[str] = None


AutomationCondition = AutomationConditionState | AutomationConditionNumericState | AutomationConditionTime


class AutomationActionService(BaseModel):
    """Service action for automation"""

    type: Literal["service"] = "service"
    domain: str
    service: str
    entity_id: str
    data: Dict[str, Any] = Field(default_factory=dict)


class AutomationActionNotification(BaseModel):
    """Notification action for automation"""

    type: Literal["notification"] = "notification"
    title: str
    message: str


class AutomationActionDelay(BaseModel):
    """Delay action for automation"""

    type: Literal["delay"] = "delay"
    seconds: int


AutomationAction = AutomationActionService | AutomationActionNotification | AutomationActionDelay


class Automation(BaseModel):
    """Automation definition"""

    id: str
    name: str
    description: Optional[str] = None
    enabled: bool
    trigger: AutomationTrigger
    conditions: List[AutomationCondition] = Field(default_factory=list)
    actions: List[AutomationAction] = Field(default_factory=list)

