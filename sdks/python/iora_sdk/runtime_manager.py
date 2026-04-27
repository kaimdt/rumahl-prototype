"""
IORA SDK Runtime Manager

Handles app lifecycle, communication with IORA, and permission management.
"""

import asyncio
import os
import logging
from typing import Optional, Dict, Callable, Any
from dataclasses import dataclass

from .runtime import (
    AppStatus,
    LogLevel,
    PermissionToken,
    HeartbeatMessage,
    StatusUpdateMessage,
    LogMessage,
    PermissionRequestMessage,
)
from .permissions import Permission


logger = logging.getLogger(__name__)


@dataclass
class RuntimeConfig:
    """Configuration for the runtime manager"""

    app_id: str
    heartbeat_interval: int = 5
    iora_endpoint: str = ""
    auto_heartbeat: bool = True
    query_timeout: int = 30


class RuntimeManager:
    """
    Runtime manager handles app lifecycle, communication with IORA,
    and permission management
    """

    def __init__(self, config: RuntimeConfig):
        self.config = config
        self.status = AppStatus.INITIALIZING
        self.permission_tokens: Dict[str, PermissionToken] = {}
        self.query_handlers: Dict[str, Callable] = {}
        self._heartbeat_task: Optional[asyncio.Task] = None
        self._permission_renewal_task: Optional[asyncio.Task] = None
        self._message_queue: asyncio.Queue = asyncio.Queue()

    @classmethod
    def from_env(cls) -> "RuntimeManager":
        """Create runtime manager from environment variables"""
        app_id = os.getenv("IORA_APP_ID")
        if not app_id:
            raise RuntimeError("IORA_APP_ID environment variable not set")

        iora_endpoint = os.getenv("IORA_ENDPOINT")
        if not iora_endpoint:
            raise RuntimeError("IORA_ENDPOINT environment variable not set")

        heartbeat_interval = int(os.getenv("IORA_HEARTBEAT_INTERVAL", "5"))

        config = RuntimeConfig(
            app_id=app_id,
            heartbeat_interval=heartbeat_interval,
            iora_endpoint=iora_endpoint,
            auto_heartbeat=True,
            query_timeout=30,
        )

        return cls(config)

    async def start(self) -> None:
        """Start the runtime manager"""
        # Update status to idle
        await self.set_status(AppStatus.IDLE)

        # Start heartbeat task
        if self.config.auto_heartbeat:
            self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())

        # Start message processor
        asyncio.create_task(self._process_messages())

        # Start permission renewal task
        self._permission_renewal_task = asyncio.create_task(
            self._permission_renewal_loop()
        )

        # Register default handlers
        await self._register_default_handlers()

        logger.info(f"Runtime manager started for app {self.config.app_id}")

    async def stop(self) -> None:
        """Stop the runtime manager"""
        await self.set_status(AppStatus.SHUTTING_DOWN)

        if self._heartbeat_task:
            self._heartbeat_task.cancel()

        if self._permission_renewal_task:
            self._permission_renewal_task.cancel()

        logger.info("Runtime manager stopped")

    async def set_status(
        self, new_status: AppStatus, details: Optional[str] = None
    ) -> None:
        """Set app status"""
        old_status = self.status
        self.status = new_status

        # Send status update to IORA
        message = StatusUpdateMessage(
            app_id=self.config.app_id,
            old_status=old_status,
            new_status=new_status,
            details=details,
        )

        await self._send_message(message)

    def get_status(self) -> AppStatus:
        """Get current app status"""
        return self.status

    async def log(
        self,
        level: LogLevel,
        message: str,
        context: Optional[Dict[str, Any]] = None,
    ) -> None:
        """Log a message to IORA"""
        log_message = LogMessage(
            app_id=self.config.app_id, level=level, message=message, context=context
        )

        await self._send_message(log_message)

        # Also log locally
        local_logger = logging.getLogger(self.config.app_id)
        log_func = getattr(local_logger, level.value.lower())
        log_func(f"{message} {context if context else ''}")

    async def request_permission(
        self, permission: Permission, context: str, duration: int = 300
    ) -> Optional[PermissionToken]:
        """Request a permission from IORA"""
        permission_str = permission.value

        # Check if we already have a valid token
        if permission_str in self.permission_tokens:
            token = self.permission_tokens[permission_str]
            if not token.is_expired() and not token.needs_renewal():
                return token

        # Request new token from IORA
        message = PermissionRequestMessage(
            app_id=self.config.app_id,
            permission=permission_str,
            context=context,
            duration=duration,
        )

        await self._send_message(message)

        # In real implementation, would wait for response
        # For now, return None to indicate pending
        logger.warning(f"Permission request sent for {permission_str}, awaiting response")
        return None

    def store_permission_token(self, token: PermissionToken) -> None:
        """Store a permission token"""
        self.permission_tokens[token.permission] = token

    def register_query_handler(
        self, command: str, handler: Callable[[Any], Any]
    ) -> None:
        """Register a query handler"""
        self.query_handlers[command] = handler

    async def _send_message(self, message: Any) -> None:
        """Send a message to IORA"""
        await self._message_queue.put(message)

    async def _process_messages(self) -> None:
        """Process outgoing messages"""
        while True:
            try:
                message = await self._message_queue.get()
                # In real implementation, send via WebSocket/Unix socket
                logger.debug(
                    f"Sending to IORA ({self.config.iora_endpoint}): {message}"
                )
            except Exception as e:
                logger.error(f"Error processing message: {e}")

    async def _heartbeat_loop(self) -> None:
        """Send periodic heartbeats"""
        while True:
            try:
                message = HeartbeatMessage(
                    app_id=self.config.app_id, status=self.status
                )
                await self._send_message(message)
                await asyncio.sleep(self.config.heartbeat_interval)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error sending heartbeat: {e}")

    async def _permission_renewal_loop(self) -> None:
        """Automatically renew expiring permissions"""
        while True:
            try:
                await asyncio.sleep(10)

                for permission, token in list(self.permission_tokens.items()):
                    if token.needs_renewal():
                        await self.request_permission(
                            Permission(permission), "Auto-renewal", 300
                        )
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error renewing permissions: {e}")

    async def _register_default_handlers(self) -> None:
        """Register default query handlers"""

        def get_status_handler(params: Any) -> Dict[str, Any]:
            return {"status": self.status.value, "uptime": 0}

        self.register_query_handler("get_status", get_status_handler)
