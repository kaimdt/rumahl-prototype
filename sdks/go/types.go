// Package ora provides type definitions for rumahl SDK
package ora

import "time"

// Entity represents a smart home entity
type Entity struct {
	EntityID    string                 `json:"entity_id"`
	State       string                 `json:"state"`
	Attributes  map[string]interface{} `json:"attributes"`
	LastChanged *time.Time             `json:"last_changed,omitempty"`
	LastUpdated *time.Time             `json:"last_updated,omitempty"`
}

// ServiceCall represents a service call to control an entity
type ServiceCall struct {
	Domain      string                 `json:"domain"`
	Service     string                 `json:"service"`
	EntityID    string                 `json:"entity_id"`
	ServiceData map[string]interface{} `json:"service_data,omitempty"`
}

// NotificationAction represents a notification action button
type NotificationAction struct {
	Action string `json:"action"`
	Title  string `json:"title"`
}

// NotificationPayload represents a notification
type NotificationPayload struct {
	Title    string               `json:"title"`
	Message  string               `json:"message"`
	Priority string               `json:"priority,omitempty"` // low, normal, high, critical
	Icon     string               `json:"icon,omitempty"`
	Actions  []NotificationAction `json:"actions,omitempty"`
}

// AppSettings represents app settings
type AppSettings struct {
	AppID    string                 `json:"app_id"`
	Settings map[string]interface{} `json:"settings"`
}

// HealthStatus represents health check status
type HealthStatus struct {
	Healthy bool                   `json:"healthy"`
	Message string                 `json:"message,omitempty"`
	Details map[string]interface{} `json:"details,omitempty"`
}

// rumahlEvent represents an rumahl event
type rumahlEvent struct {
	Type      string      `json:"type"`
	Data      interface{} `json:"data"`
	Timestamp int64       `json:"timestamp"`
}

// IframeMessage represents iframe communication message
type IframeMessage struct {
	Type   string                 `json:"type"` // request, response, event
	ID     string                 `json:"id,omitempty"`
	Method string                 `json:"method,omitempty"`
	Params []interface{}          `json:"params,omitempty"`
	Result interface{}            `json:"result,omitempty"`
	Error  map[string]interface{} `json:"error,omitempty"`
	Event  *rumahlEvent             `json:"event,omitempty"`
}
