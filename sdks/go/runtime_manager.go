// Package iora provides runtime manager for IORA apps
package iora

import (
	"context"
	"fmt"
	"log"
	"os"
	"strconv"
	"sync"
	"time"
)

// RuntimeConfig holds the runtime configuration
type RuntimeConfig struct {
	AppID             string
	HeartbeatInterval time.Duration
	IoraEndpoint      string
	AutoHeartbeat     bool
	QueryTimeout      time.Duration
}

// QueryHandler is a function that handles queries from IORA
type QueryHandler func(params map[string]interface{}) (interface{}, error)

// RuntimeManager handles app lifecycle, communication with IORA, and permission management
type RuntimeManager struct {
	config           RuntimeConfig
	status           AppStatus
	statusMu         sync.RWMutex
	permissionTokens map[string]*PermissionToken
	permissionMu     sync.RWMutex
	queryHandlers    map[string]QueryHandler
	queryMu          sync.RWMutex
	messageQueue     chan IoraMessage
	ctx              context.Context
	cancel           context.CancelFunc
}

// NewRuntimeManager creates a new runtime manager
func NewRuntimeManager(config RuntimeConfig) *RuntimeManager {
	ctx, cancel := context.WithCancel(context.Background())

	return &RuntimeManager{
		config:           config,
		status:           AppStatusInitializing,
		permissionTokens: make(map[string]*PermissionToken),
		queryHandlers:    make(map[string]QueryHandler),
		messageQueue:     make(chan IoraMessage, 100),
		ctx:              ctx,
		cancel:           cancel,
	}
}

// FromEnv creates a runtime manager from environment variables
func RuntimeManagerFromEnv() (*RuntimeManager, error) {
	appID := os.Getenv("IORA_APP_ID")
	if appID == "" {
		return nil, fmt.Errorf("IORA_APP_ID environment variable not set")
	}

	ioraEndpoint := os.Getenv("IORA_ENDPOINT")
	if ioraEndpoint == "" {
		return nil, fmt.Errorf("IORA_ENDPOINT environment variable not set")
	}

	heartbeatInterval := 5
	if val := os.Getenv("IORA_HEARTBEAT_INTERVAL"); val != "" {
		if parsed, err := strconv.Atoi(val); err == nil {
			heartbeatInterval = parsed
		}
	}

	config := RuntimeConfig{
		AppID:             appID,
		HeartbeatInterval: time.Duration(heartbeatInterval) * time.Second,
		IoraEndpoint:      ioraEndpoint,
		AutoHeartbeat:     true,
		QueryTimeout:      30 * time.Second,
	}

	return NewRuntimeManager(config), nil
}

// Start starts the runtime manager
func (rm *RuntimeManager) Start() error {
	// Update status to idle
	if err := rm.SetStatus(AppStatusIdle, ""); err != nil {
		return err
	}

	// Start heartbeat
	if rm.config.AutoHeartbeat {
		go rm.heartbeatLoop()
	}

	// Start message processor
	go rm.messageProcessor()

	// Start permission renewal
	go rm.permissionRenewalLoop()

	// Register default handlers
	rm.registerDefaultHandlers()

	log.Printf("Runtime manager started for app %s", rm.config.AppID)
	return nil
}

// Stop stops the runtime manager
func (rm *RuntimeManager) Stop() error {
	if err := rm.SetStatus(AppStatusShuttingDown, ""); err != nil {
		return err
	}

	rm.cancel()
	close(rm.messageQueue)

	log.Println("Runtime manager stopped")
	return nil
}

// SetStatus sets the app status
func (rm *RuntimeManager) SetStatus(newStatus AppStatus, details string) error {
	rm.statusMu.Lock()
	oldStatus := rm.status
	rm.status = newStatus
	rm.statusMu.Unlock()

	// Send status update to IORA
	msg := NewStatusUpdateMessage(rm.config.AppID, oldStatus, newStatus, details)
	return rm.sendMessage(msg)
}

// GetStatus returns the current app status
func (rm *RuntimeManager) GetStatus() AppStatus {
	rm.statusMu.RLock()
	defer rm.statusMu.RUnlock()
	return rm.status
}

// Log logs a message to IORA
func (rm *RuntimeManager) Log(level LogLevel, message string, context map[string]interface{}) error {
	msg := NewLogMessage(rm.config.AppID, level, message, context)

	// Send to IORA
	if err := rm.sendMessage(msg); err != nil {
		return err
	}

	// Also log locally
	switch level {
	case LogLevelDebug:
		log.Printf("[DEBUG] %s %v", message, context)
	case LogLevelInfo:
		log.Printf("[INFO] %s %v", message, context)
	case LogLevelWarning:
		log.Printf("[WARNING] %s %v", message, context)
	case LogLevelError, LogLevelCritical:
		log.Printf("[%s] %s %v", level, message, context)
	}

	return nil
}

// RequestPermission requests a permission from IORA
func (rm *RuntimeManager) RequestPermission(permission Permission, context string, duration int64) (*PermissionToken, error) {
	permStr := permission_to_string(permission)

	// Check if we already have a valid token
	rm.permissionMu.RLock()
	if token, exists := rm.permissionTokens[permStr]; exists {
		if !token.IsExpired() && !token.NeedsRenewal() {
			rm.permissionMu.RUnlock()
			return token, nil
		}
	}
	rm.permissionMu.RUnlock()

	// Request new token from IORA
	msg := NewPermissionRequestMessage(rm.config.AppID, permStr, context, duration)
	if err := rm.sendMessage(msg); err != nil {
		return nil, err
	}

	// In real implementation, would wait for response
	log.Printf("Permission request sent for %s, awaiting response", permStr)
	return nil, nil
}

// StorePermissionToken stores a permission token
func (rm *RuntimeManager) StorePermissionToken(token *PermissionToken) {
	rm.permissionMu.Lock()
	rm.permissionTokens[token.Permission] = token
	rm.permissionMu.Unlock()
}

// RegisterQueryHandler registers a query handler
func (rm *RuntimeManager) RegisterQueryHandler(command string, handler QueryHandler) {
	rm.queryMu.Lock()
	rm.queryHandlers[command] = handler
	rm.queryMu.Unlock()
}

// sendMessage sends a message to IORA
func (rm *RuntimeManager) sendMessage(msg IoraMessage) error {
	select {
	case rm.messageQueue <- msg:
		return nil
	case <-rm.ctx.Done():
		return fmt.Errorf("runtime manager stopped")
	default:
		return fmt.Errorf("message queue full")
	}
}

// heartbeatLoop sends periodic heartbeats
func (rm *RuntimeManager) heartbeatLoop() {
	ticker := time.NewTicker(rm.config.HeartbeatInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			status := rm.GetStatus()
			msg := NewHeartbeatMessage(rm.config.AppID, status)
			if err := rm.sendMessage(msg); err != nil {
				log.Printf("Failed to send heartbeat: %v", err)
			}
		case <-rm.ctx.Done():
			return
		}
	}
}

// messageProcessor processes outgoing messages
func (rm *RuntimeManager) messageProcessor() {
	for {
		select {
		case msg := <-rm.messageQueue:
			// In real implementation, send via WebSocket/HTTP
			log.Printf("Sending to IORA (%s): %v", rm.config.IoraEndpoint, msg)
		case <-rm.ctx.Done():
			return
		}
	}
}

// permissionRenewalLoop automatically renews expiring permissions
func (rm *RuntimeManager) permissionRenewalLoop() {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			rm.permissionMu.RLock()
			for permStr, token := range rm.permissionTokens {
				if token.NeedsRenewal() {
					// Request renewal asynchronously
					go func(p string) {
						perm := Permission(0) // Would need proper conversion
						rm.RequestPermission(perm, "Auto-renewal", 300)
					}(permStr)
				}
			}
			rm.permissionMu.RUnlock()
		case <-rm.ctx.Done():
			return
		}
	}
}

// registerDefaultHandlers registers default query handlers
func (rm *RuntimeManager) registerDefaultHandlers() {
	rm.RegisterQueryHandler("get_status", func(params map[string]interface{}) (interface{}, error) {
		return map[string]interface{}{
			"status": rm.GetStatus(),
			"uptime": 0, // Would track actual uptime
		}, nil
	})
}
