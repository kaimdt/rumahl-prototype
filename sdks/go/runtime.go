// Package ora provides runtime components for rumahl SDK
package ora

import (
	"encoding/json"
	"time"
)

// AppStatus represents the runtime status of an app
type AppStatus string

const (
	AppStatusInitializing  AppStatus = "INITIALIZING"
	AppStatusIdle          AppStatus = "IDLE"
	AppStatusActive        AppStatus = "ACTIVE"
	AppStatusBackgroundTask AppStatus = "BACKGROUND_TASK"
	AppStatusProcessing    AppStatus = "PROCESSING"
	AppStatusBusy          AppStatus = "BUSY"
	AppStatusError         AppStatus = "ERROR"
	AppStatusShuttingDown  AppStatus = "SHUTTING_DOWN"
)

// LogLevel represents the severity of a log message
type LogLevel string

const (
	LogLevelDebug    LogLevel = "DEBUG"
	LogLevelInfo     LogLevel = "INFO"
	LogLevelWarning  LogLevel = "WARNING"
	LogLevelError    LogLevel = "ERROR"
	LogLevelCritical LogLevel = "CRITICAL"
)

// PermissionToken represents a permission token with expiration
type PermissionToken struct {
	Token      string `json:"token"`
	Permission string `json:"permission"`
	ExpiresAt  int64  `json:"expires_at"`
	GrantedAt  int64  `json:"granted_at"`
}

// IsExpired checks if the token is expired
func (pt *PermissionToken) IsExpired() bool {
	return time.Now().Unix() >= pt.ExpiresAt
}

// NeedsRenewal checks if the token needs renewal (within 30 seconds)
func (pt *PermissionToken) NeedsRenewal() bool {
	return (pt.ExpiresAt - time.Now().Unix()) < 30
}

// rumahlMessage is the base interface for all rumahl messages
type rumahlMessage interface {
	MessageType() string
}

// HeartbeatMessage represents a heartbeat signal
type HeartbeatMessage struct {
	Type      string    `json:"type"`
	AppID     string    `json:"app_id"`
	Status    AppStatus `json:"status"`
	Timestamp int64     `json:"timestamp"`
}

func (m HeartbeatMessage) MessageType() string { return "heartbeat" }

// StatusUpdateMessage represents a status change
type StatusUpdateMessage struct {
	Type      string    `json:"type"`
	AppID     string    `json:"app_id"`
	OldStatus AppStatus `json:"old_status"`
	NewStatus AppStatus `json:"new_status"`
	Details   string    `json:"details,omitempty"`
	Timestamp int64     `json:"timestamp"`
}

func (m StatusUpdateMessage) MessageType() string { return "status_update" }

// LogMessage represents a log entry
type LogMessage struct {
	Type      string                 `json:"type"`
	AppID     string                 `json:"app_id"`
	Level     LogLevel               `json:"level"`
	Message   string                 `json:"message"`
	Context   map[string]interface{} `json:"context,omitempty"`
	Timestamp int64                  `json:"timestamp"`
}

func (m LogMessage) MessageType() string { return "log" }

// PermissionRequestMessage represents a permission request
type PermissionRequestMessage struct {
	Type       string `json:"type"`
	AppID      string `json:"app_id"`
	Permission string `json:"permission"`
	Context    string `json:"context"`
	Duration   int64  `json:"duration"`
	Timestamp  int64  `json:"timestamp"`
}

func (m PermissionRequestMessage) MessageType() string { return "permission_request" }

// PermissionGrantMessage represents a permission grant
type PermissionGrantMessage struct {
	Type       string `json:"type"`
	Token      string `json:"token"`
	ExpiresAt  int64  `json:"expires_at"`
	Permission string `json:"permission"`
	Timestamp  int64  `json:"timestamp"`
}

func (m PermissionGrantMessage) MessageType() string { return "permission_grant" }

// QueryMessage represents a query from rumahl
type QueryMessage struct {
	Type      string                 `json:"type"`
	QueryID   string                 `json:"query_id"`
	Command   string                 `json:"command"`
	Params    map[string]interface{} `json:"params,omitempty"`
	Timestamp int64                  `json:"timestamp"`
}

func (m QueryMessage) MessageType() string { return "query" }

// ResponseMessage represents a response to a query
type ResponseMessage struct {
	Type      string      `json:"type"`
	QueryID   string      `json:"query_id"`
	Data      interface{} `json:"data"`
	Timestamp int64       `json:"timestamp"`
}

func (m ResponseMessage) MessageType() string { return "response" }

// ErrorResponseMessage represents an error response
type ErrorResponseMessage struct {
	Type      string `json:"type"`
	QueryID   string `json:"query_id"`
	Error     string `json:"error"`
	Timestamp int64  `json:"timestamp"`
}

func (m ErrorResponseMessage) MessageType() string { return "error_response" }

// Helper functions to create messages

// NewHeartbeatMessage creates a new heartbeat message
func NewHeartbeatMessage(appID string, status AppStatus) *HeartbeatMessage {
	return &HeartbeatMessage{
		Type:      "heartbeat",
		AppID:     appID,
		Status:    status,
		Timestamp: time.Now().Unix(),
	}
}

// NewStatusUpdateMessage creates a new status update message
func NewStatusUpdateMessage(appID string, oldStatus, newStatus AppStatus, details string) *StatusUpdateMessage {
	return &StatusUpdateMessage{
		Type:      "status_update",
		AppID:     appID,
		OldStatus: oldStatus,
		NewStatus: newStatus,
		Details:   details,
		Timestamp: time.Now().Unix(),
	}
}

// NewLogMessage creates a new log message
func NewLogMessage(appID string, level LogLevel, message string, context map[string]interface{}) *LogMessage {
	return &LogMessage{
		Type:      "log",
		AppID:     appID,
		Level:     level,
		Message:   message,
		Context:   context,
		Timestamp: time.Now().Unix(),
	}
}

// NewPermissionRequestMessage creates a new permission request message
func NewPermissionRequestMessage(appID, permission, context string, duration int64) *PermissionRequestMessage {
	return &PermissionRequestMessage{
		Type:       "permission_request",
		AppID:      appID,
		Permission: permission,
		Context:    context,
		Duration:   duration,
		Timestamp:  time.Now().Unix(),
	}
}

// ToJSON converts a message to JSON
func ToJSON(msg rumahlMessage) ([]byte, error) {
	return json.Marshal(msg)
}
