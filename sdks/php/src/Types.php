<?php

namespace rumahl;

/**
 * Entity represents a smart home entity
 */
class Entity
{
    public function __construct(
        public string $entityId,
        public string $state,
        public array $attributes = [],
        public ?string $lastChanged = null,
        public ?string $lastUpdated = null
    ) {
    }

    public static function fromArray(array $data): self
    {
        return new self(
            entityId: $data['entity_id'],
            state: $data['state'],
            attributes: $data['attributes'] ?? [],
            lastChanged: $data['last_changed'] ?? null,
            lastUpdated: $data['last_updated'] ?? null
        );
    }

    public function toArray(): array
    {
        return [
            'entity_id' => $this->entityId,
            'state' => $this->state,
            'attributes' => $this->attributes,
            'last_changed' => $this->lastChanged,
            'last_updated' => $this->lastUpdated,
        ];
    }
}

/**
 * Service call to control an entity
 */
class ServiceCall
{
    public function __construct(
        public string $domain,
        public string $service,
        public string $entityId,
        public array $serviceData = []
    ) {
    }
}

/**
 * Notification action button
 */
class NotificationAction
{
    public function __construct(
        public string $action,
        public string $title
    ) {
    }

    public function toArray(): array
    {
        return [
            'action' => $this->action,
            'title' => $this->title,
        ];
    }
}

/**
 * Notification payload
 */
class NotificationPayload
{
    /** @var NotificationAction[] */
    public array $actions = [];

    public function __construct(
        public string $title,
        public string $message,
        public string $priority = 'normal',
        public ?string $icon = null,
        array $actions = []
    ) {
        $this->actions = $actions;
    }

    public function toArray(): array
    {
        return [
            'title' => $this->title,
            'message' => $this->message,
            'priority' => $this->priority,
            'icon' => $this->icon,
            'actions' => array_map(fn($action) => $action->toArray(), $this->actions),
        ];
    }
}

/**
 * App settings
 */
class AppSettings
{
    public function __construct(
        public string $appId,
        public array $settings = []
    ) {
    }

    public static function fromArray(array $data): self
    {
        return new self(
            appId: $data['app_id'],
            settings: $data['settings'] ?? []
        );
    }

    public function toArray(): array
    {
        return [
            'app_id' => $this->appId,
            'settings' => $this->settings,
        ];
    }
}

/**
 * Health status
 */
class HealthStatus
{
    public function __construct(
        public bool $healthy,
        public ?string $message = null,
        public array $details = []
    ) {
    }

    public static function fromArray(array $data): self
    {
        return new self(
            healthy: $data['healthy'],
            message: $data['message'] ?? null,
            details: $data['details'] ?? []
        );
    }

    public function toArray(): array
    {
        return [
            'healthy' => $this->healthy,
            'message' => $this->message,
            'details' => $this->details,
        ];
    }
}
