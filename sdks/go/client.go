// Package iora provides the official Go SDK for IORA app and plugin development
package iora

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// Client is the main IORA API client
type Client struct {
	BaseURL    string
	APIKey     string
	HTTPClient *http.Client
}

// NewClient creates a new IORA API client
func NewClient(baseURL string, apiKey string) *Client {
	return &Client{
		BaseURL: baseURL,
		APIKey:  apiKey,
		HTTPClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// request makes an authenticated HTTP request
func (c *Client) request(method, path string, body interface{}) ([]byte, error) {
	var reqBody io.Reader
	if body != nil {
		jsonData, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal request body: %w", err)
		}
		reqBody = bytes.NewBuffer(jsonData)
	}

	req, err := http.NewRequest(method, c.BaseURL+path, reqBody)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	if c.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.APIKey)
	}

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("API error (%d): %s", resp.StatusCode, string(respBody))
	}

	return respBody, nil
}

// GetEntities retrieves all entities
func (c *Client) GetEntities() ([]Entity, error) {
	data, err := c.request("GET", "/api/states", nil)
	if err != nil {
		return nil, err
	}

	var entities []Entity
	if err := json.Unmarshal(data, &entities); err != nil {
		return nil, fmt.Errorf("failed to unmarshal entities: %w", err)
	}

	return entities, nil
}

// GetEntity retrieves a specific entity
func (c *Client) GetEntity(entityID string) (*Entity, error) {
	data, err := c.request("GET", "/api/states/"+entityID, nil)
	if err != nil {
		return nil, err
	}

	var entity Entity
	if err := json.Unmarshal(data, &entity); err != nil {
		return nil, fmt.Errorf("failed to unmarshal entity: %w", err)
	}

	return &entity, nil
}

// CallService calls a service on an entity
func (c *Client) CallService(call ServiceCall) error {
	path := fmt.Sprintf("/api/services/%s/%s", call.Domain, call.Service)
	_, err := c.request("POST", path, map[string]interface{}{
		"entity_id":    call.EntityID,
		"service_data": call.ServiceData,
	})
	return err
}

// TurnOn turns on a device
func (c *Client) TurnOn(entityID string, data map[string]interface{}) error {
	domain := getEntityDomain(entityID)
	return c.CallService(ServiceCall{
		Domain:      domain,
		Service:     "turn_on",
		EntityID:    entityID,
		ServiceData: data,
	})
}

// TurnOff turns off a device
func (c *Client) TurnOff(entityID string) error {
	domain := getEntityDomain(entityID)
	return c.CallService(ServiceCall{
		Domain:      domain,
		Service:     "turn_off",
		EntityID:    entityID,
		ServiceData: make(map[string]interface{}),
	})
}

// SendNotification sends a notification
func (c *Client) SendNotification(notification NotificationPayload) error {
	_, err := c.request("POST", "/api/notifications/send", notification)
	return err
}

// GetNotifications retrieves all notifications
func (c *Client) GetNotifications() ([]map[string]interface{}, error) {
	data, err := c.request("GET", "/api/notifications", nil)
	if err != nil {
		return nil, err
	}

	var notifications []map[string]interface{}
	if err := json.Unmarshal(data, &notifications); err != nil {
		return nil, fmt.Errorf("failed to unmarshal notifications: %w", err)
	}

	return notifications, nil
}

// SetStorage stores a value
func (c *Client) SetStorage(key string, value interface{}) error {
	_, err := c.request("PUT", "/api/storage/"+key, value)
	return err
}

// GetStorage retrieves a stored value
func (c *Client) GetStorage(key string, result interface{}) error {
	data, err := c.request("GET", "/api/storage/"+key, nil)
	if err != nil {
		return err
	}

	if err := json.Unmarshal(data, result); err != nil {
		return fmt.Errorf("failed to unmarshal storage data: %w", err)
	}

	return nil
}

// DeleteStorage deletes a stored value
func (c *Client) DeleteStorage(key string) error {
	_, err := c.request("DELETE", "/api/storage/"+key, nil)
	return err
}

// GetSettings retrieves app settings
func (c *Client) GetSettings(appID string) (*AppSettings, error) {
	data, err := c.request("GET", "/api/appstore/apps/"+appID+"/settings", nil)
	if err != nil {
		return nil, err
	}

	var settings AppSettings
	if err := json.Unmarshal(data, &settings); err != nil {
		return nil, fmt.Errorf("failed to unmarshal settings: %w", err)
	}

	return &settings, nil
}

// UpdateSettings updates app settings
func (c *Client) UpdateSettings(appID string, settings map[string]interface{}) error {
	_, err := c.request("POST", "/api/appstore/settings", map[string]interface{}{
		"app_id":   appID,
		"settings": settings,
	})
	return err
}

// Helper function to extract domain from entity ID
func getEntityDomain(entityID string) string {
	for i, ch := range entityID {
		if ch == '.' {
			return entityID[:i]
		}
	}
	return ""
}
