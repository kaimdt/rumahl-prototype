<?php

namespace Iora;

use GuzzleHttp\Client as HttpClient;
use GuzzleHttp\Exception\GuzzleException;

/**
 * IORA API Client
 *
 * HTTP client for interacting with IORA APIs
 */
class Client
{
    private string $baseUrl;
    private ?string $apiKey;
    private HttpClient $httpClient;

    public function __construct(string $baseUrl = 'http://localhost:8080', ?string $apiKey = null)
    {
        $this->baseUrl = rtrim($baseUrl, '/');
        $this->apiKey = $apiKey;
        $this->httpClient = new HttpClient([
            'timeout' => 30,
            'base_uri' => $this->baseUrl,
        ]);
    }

    public function setApiKey(string $apiKey): void
    {
        $this->apiKey = $apiKey;
    }

    /**
     * Make an authenticated HTTP request
     *
     * @param string $method HTTP method
     * @param string $path Request path
     * @param mixed $body Request body
     * @return mixed Response data
     * @throws \Exception
     */
    private function request(string $method, string $path, mixed $body = null): mixed
    {
        $headers = [
            'Content-Type' => 'application/json',
        ];

        if ($this->apiKey !== null) {
            $headers['Authorization'] = 'Bearer ' . $this->apiKey;
        }

        $options = [
            'headers' => $headers,
        ];

        if ($body !== null) {
            $options['json'] = $body;
        }

        try {
            $response = $this->httpClient->request($method, $path, $options);
            $responseBody = (string) $response->getBody();

            if (empty($responseBody)) {
                return null;
            }

            return json_decode($responseBody, true);
        } catch (GuzzleException $e) {
            throw new \Exception('API request failed: ' . $e->getMessage(), 0, $e);
        }
    }

    /**
     * Get all entities
     *
     * @return array<Entity>
     */
    public function getEntities(): array
    {
        $data = $this->request('GET', '/api/states');
        return array_map(fn($entity) => Entity::fromArray($entity), $data);
    }

    /**
     * Get a specific entity
     *
     * @param string $entityId Entity ID
     * @return Entity
     */
    public function getEntity(string $entityId): Entity
    {
        $data = $this->request('GET', '/api/states/' . $entityId);
        return Entity::fromArray($data);
    }

    /**
     * Call a service on an entity
     *
     * @param ServiceCall $call Service call
     * @return mixed
     */
    public function callService(ServiceCall $call): mixed
    {
        return $this->request(
            'POST',
            '/api/services/' . $call->domain . '/' . $call->service,
            [
                'entity_id' => $call->entityId,
                'service_data' => $call->serviceData,
            ]
        );
    }

    /**
     * Turn on a device
     *
     * @param string $entityId Entity ID
     * @param array $data Service data
     * @return mixed
     */
    public function turnOn(string $entityId, array $data = []): mixed
    {
        $domain = explode('.', $entityId)[0];
        return $this->callService(new ServiceCall(
            domain: $domain,
            service: 'turn_on',
            entityId: $entityId,
            serviceData: $data
        ));
    }

    /**
     * Turn off a device
     *
     * @param string $entityId Entity ID
     * @return mixed
     */
    public function turnOff(string $entityId): mixed
    {
        $domain = explode('.', $entityId)[0];
        return $this->callService(new ServiceCall(
            domain: $domain,
            service: 'turn_off',
            entityId: $entityId,
            serviceData: []
        ));
    }

    /**
     * Send a notification
     *
     * @param NotificationPayload $notification Notification data
     * @return mixed
     */
    public function sendNotification(NotificationPayload $notification): mixed
    {
        return $this->request('POST', '/api/notifications/send', $notification->toArray());
    }

    /**
     * Get all notifications
     *
     * @return array
     */
    public function getNotifications(): array
    {
        return $this->request('GET', '/api/notifications');
    }

    /**
     * Store a value
     *
     * @param string $key Storage key
     * @param mixed $value Value to store
     * @return mixed
     */
    public function setStorage(string $key, mixed $value): mixed
    {
        return $this->request('PUT', '/api/storage/' . $key, $value);
    }

    /**
     * Get a stored value
     *
     * @param string $key Storage key
     * @return mixed
     */
    public function getStorage(string $key): mixed
    {
        return $this->request('GET', '/api/storage/' . $key);
    }

    /**
     * Delete a stored value
     *
     * @param string $key Storage key
     * @return mixed
     */
    public function deleteStorage(string $key): mixed
    {
        return $this->request('DELETE', '/api/storage/' . $key);
    }

    /**
     * Get app settings
     *
     * @param string $appId App ID
     * @return AppSettings
     */
    public function getSettings(string $appId): AppSettings
    {
        $data = $this->request('GET', '/api/appstore/apps/' . $appId . '/settings');
        return AppSettings::fromArray($data);
    }

    /**
     * Update app settings
     *
     * @param string $appId App ID
     * @param array $settings Settings data
     * @return mixed
     */
    public function updateSettings(string $appId, array $settings): mixed
    {
        return $this->request('POST', '/api/appstore/settings', [
            'app_id' => $appId,
            'settings' => $settings,
        ]);
    }
}
