"""
Plugin development framework
"""

from abc import ABC, abstractmethod
from typing import Any, Dict, Optional
from iora_sdk.client import IoraClient
from iora_sdk.types import Entity


class PluginContext:
    """Context provided to plugins during execution"""

    def __init__(
        self,
        client: IoraClient,
        app_id: str,
        settings: Dict[str, Any],
        input_data: Optional[Dict[str, Any]] = None,
    ):
        """
        Initialize plugin context

        Args:
            client: IORA API client
            app_id: Plugin app ID
            settings: Plugin settings
            input_data: Input data for the plugin
        """
        self.client = client
        self.app_id = app_id
        self.settings = settings
        self.input_data = input_data or {}

    async def get_entity(self, entity_id: str) -> Entity:
        """Get an entity"""
        return await self.client.get_entity(entity_id)

    async def call_service(self, domain: str, service: str, entity_id: str, data: Optional[Dict[str, Any]] = None) -> Any:
        """Call a service"""
        from iora_sdk.types import ServiceCall

        return await self.client.call_service(
            ServiceCall(domain=domain, service=service, entity_id=entity_id, service_data=data or {})
        )

    async def store(self, key: str, value: Any) -> None:
        """Store data"""
        await self.client.set_storage(f"{self.app_id}:{key}", value)

    async def retrieve(self, key: str) -> Any:
        """Retrieve stored data"""
        return await self.client.get_storage(f"{self.app_id}:{key}")

    async def notify(self, title: str, message: str, priority: str = "normal") -> None:
        """Send a notification"""
        from iora_sdk.types import NotificationPayload

        await self.client.send_notification(
            NotificationPayload(title=title, message=message, priority=priority)
        )


class Plugin(ABC):
    """
    Base class for IORA plugins

    Plugins are on-demand code execution units that run in a sandbox.
    """

    @abstractmethod
    async def execute(self, context: PluginContext) -> Dict[str, Any]:
        """
        Execute the plugin

        Args:
            context: Plugin execution context

        Returns:
            Result dictionary
        """
        pass

    async def on_install(self, context: PluginContext) -> None:
        """
        Called when plugin is installed

        Args:
            context: Plugin execution context
        """
        pass

    async def on_uninstall(self, context: PluginContext) -> None:
        """
        Called when plugin is uninstalled

        Args:
            context: Plugin execution context
        """
        pass

    async def on_settings_changed(self, context: PluginContext) -> None:
        """
        Called when plugin settings are changed

        Args:
            context: Plugin execution context
        """
        pass


class DataProcessorPlugin(Plugin):
    """
    Base class for data processor plugins

    Data processors transform data from one format to another.
    """

    @abstractmethod
    async def process(self, context: PluginContext, data: Any) -> Any:
        """
        Process data

        Args:
            context: Plugin execution context
            data: Input data

        Returns:
            Processed data
        """
        pass

    async def execute(self, context: PluginContext) -> Dict[str, Any]:
        """Execute data processing"""
        input_data = context.input_data.get("data")
        result = await self.process(context, input_data)
        return {"result": result}


class AutomationPlugin(Plugin):
    """
    Base class for automation plugins

    Automation plugins respond to events and trigger actions.
    """

    @abstractmethod
    async def on_event(self, context: PluginContext, event: Dict[str, Any]) -> None:
        """
        Handle an event

        Args:
            context: Plugin execution context
            event: Event data
        """
        pass

    async def execute(self, context: PluginContext) -> Dict[str, Any]:
        """Execute automation"""
        event = context.input_data.get("event", {})
        await self.on_event(context, event)
        return {"status": "completed"}
