<?php

namespace rumahl;

/**
 * Plugin context provides context for plugin execution
 */
class PluginContext
{
    public function __construct(
        public Client $client,
        public string $appId,
        public array $settings = [],
        public array $inputData = []
    ) {
    }

    public function getEntity(string $entityId): Entity
    {
        return $this->client->getEntity($entityId);
    }

    public function callService(string $domain, string $service, string $entityId, array $data = []): mixed
    {
        return $this->client->callService(new ServiceCall(
            domain: $domain,
            service: $service,
            entityId: $entityId,
            serviceData: $data
        ));
    }

    public function store(string $key, mixed $value): mixed
    {
        return $this->client->setStorage("{$this->appId}:{$key}", $value);
    }

    public function retrieve(string $key): mixed
    {
        return $this->client->getStorage("{$this->appId}:{$key}");
    }

    public function notify(string $title, string $message, string $priority = 'normal'): mixed
    {
        return $this->client->sendNotification(new NotificationPayload(
            title: $title,
            message: $message,
            priority: $priority
        ));
    }
}

/**
 * Base interface for rumahl plugins
 */
interface PluginInterface
{
    public function execute(PluginContext $context): array;
    public function onInstall(PluginContext $context): void;
    public function onUninstall(PluginContext $context): void;
    public function onSettingsChanged(PluginContext $context): void;
}

/**
 * Base plugin with default implementations
 */
abstract class Plugin implements PluginInterface
{
    abstract public function execute(PluginContext $context): array;

    public function onInstall(PluginContext $context): void
    {
        // Default implementation
    }

    public function onUninstall(PluginContext $context): void
    {
        // Default implementation
    }

    public function onSettingsChanged(PluginContext $context): void
    {
        // Default implementation
    }
}

/**
 * Data processor plugin base
 */
abstract class DataProcessorPlugin extends Plugin
{
    abstract public function process(PluginContext $context, mixed $data): mixed;

    public function execute(PluginContext $context): array
    {
        $inputData = $context->inputData['data'] ?? null;
        $result = $this->process($context, $inputData);

        return [
            'result' => $result,
        ];
    }
}

/**
 * Automation plugin base
 */
abstract class AutomationPlugin extends Plugin
{
    abstract public function onEvent(PluginContext $context, array $event): void;

    public function execute(PluginContext $context): array
    {
        $event = $context->inputData['event'] ?? [];
        $this->onEvent($context, $event);

        return [
            'status' => 'completed',
        ];
    }
}
