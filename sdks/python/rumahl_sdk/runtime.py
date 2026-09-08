"""
rumahl SDK Runtime Components

This module provides the runtime infrastructure for rumahl apps including:
- Status management
- Heartbeat system
- Logging integration
- Permission management
"""

from enum import Enum
from typing import Optional, Any, Dict
from dataclasses import dataclass
from datetime import datetime
import time


class AppStatus(str, Enum):
    """App runtime status"""

    INITIALIZING = "INITIALIZING"
    IDLE = "IDLE"
    ACTIVE = "ACTIVE"
    BACKGROUND_TASK = "BACKGROUND_TASK"
    PROCESSING = "PROCESSING"
    BUSY = "BUSY"
    ERROR = "ERROR"
    SHUTTING_DOWN = "SHUTTING_DOWN"


class LogLevel(str, Enum):
    """Log level for app logging"""

    DEBUG = "DEBUG"
    INFO = "INFO"
    WARNING = "WARNING"
    ERROR = "ERROR"
    CRITICAL = "CRITICAL"


@dataclass
class PermissionToken:
    """Permission token with expiration"""

    token: str
    permission: str
    expires_at: int
    granted_at: int

    def is_expired(self) -> bool:
        """Check if token is expired"""
        return int(time.time()) >= self.expires_at

    def needs_renewal(self) -> bool:
        """Check if token needs renewal (within 30 seconds of expiration)"""
        return (self.expires_at - int(time.time())) < 30


@dataclass
class rumahlMessage:
    """Base class for rumahl messages"""

    type: str
    timestamp: int


@dataclass
class HeartbeatMessage(rumahlMessage):
    """Heartbeat signal from app to rumahl"""

    app_id: str
    status: AppStatus

    def __init__(self, app_id: str, status: AppStatus):
        super().__init__(type="heartbeat", timestamp=int(time.time()))
        self.app_id = app_id
        self.status = status


@dataclass
class StatusUpdateMessage(rumahlMessage):
    """Status update from app to rumahl"""

    app_id: str
    old_status: AppStatus
    new_status: AppStatus
    details: Optional[str] = None

    def __init__(
        self,
        app_id: str,
        old_status: AppStatus,
        new_status: AppStatus,
        details: Optional[str] = None,
    ):
        super().__init__(type="status_update", timestamp=int(time.time()))
        self.app_id = app_id
        self.old_status = old_status
        self.new_status = new_status
        self.details = details


@dataclass
class LogMessage(rumahlMessage):
    """Log entry from app to rumahl"""

    app_id: str
    level: LogLevel
    message: str
    context: Optional[Dict[str, Any]] = None

    def __init__(
        self,
        app_id: str,
        level: LogLevel,
        message: str,
        context: Optional[Dict[str, Any]] = None,
    ):
        super().__init__(type="log", timestamp=int(time.time()))
        self.app_id = app_id
        self.level = level
        self.message = message
        self.context = context


@dataclass
class PermissionRequestMessage(rumahlMessage):
    """Permission request from app to rumahl"""

    app_id: str
    permission: str
    context: str
    duration: int

    def __init__(self, app_id: str, permission: str, context: str, duration: int):
        super().__init__(type="permission_request", timestamp=int(time.time()))
        self.app_id = app_id
        self.permission = permission
        self.context = context
        self.duration = duration


@dataclass
class PermissionGrantMessage(rumahlMessage):
    """Permission grant from rumahl to app"""

    token: str
    expires_at: int
    permission: str

    def __init__(self, token: str, expires_at: int, permission: str):
        super().__init__(type="permission_grant", timestamp=int(time.time()))
        self.token = token
        self.expires_at = expires_at
        self.permission = permission


@dataclass
class QueryMessage(rumahlMessage):
    """Query from rumahl to app"""

    query_id: str
    command: str
    params: Optional[Dict[str, Any]] = None

    def __init__(
        self, query_id: str, command: str, params: Optional[Dict[str, Any]] = None
    ):
        super().__init__(type="query", timestamp=int(time.time()))
        self.query_id = query_id
        self.command = command
        self.params = params


@dataclass
class ResponseMessage(rumahlMessage):
    """Response from app to rumahl"""

    query_id: str
    data: Any

    def __init__(self, query_id: str, data: Any):
        super().__init__(type="response", timestamp=int(time.time()))
        self.query_id = query_id
        self.data = data
