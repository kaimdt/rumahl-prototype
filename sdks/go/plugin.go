// Package iora provides plugin development framework
package iora

import (
	"context"
	"fmt"
)

// PluginContext provides context for plugin execution
type PluginContext struct {
	Client    *Client
	AppID     string
	Settings  map[string]interface{}
	InputData map[string]interface{}
}

// GetEntity retrieves an entity
func (pc *PluginContext) GetEntity(entityID string) (*Entity, error) {
	return pc.Client.GetEntity(entityID)
}

// CallService calls a service
func (pc *PluginContext) CallService(domain, service, entityID string, data map[string]interface{}) error {
	return pc.Client.CallService(ServiceCall{
		Domain:      domain,
		Service:     service,
		EntityID:    entityID,
		ServiceData: data,
	})
}

// Store stores data with app-specific prefix
func (pc *PluginContext) Store(key string, value interface{}) error {
	return pc.Client.SetStorage(fmt.Sprintf("%s:%s", pc.AppID, key), value)
}

// Retrieve retrieves stored data with app-specific prefix
func (pc *PluginContext) Retrieve(key string, result interface{}) error {
	return pc.Client.GetStorage(fmt.Sprintf("%s:%s", pc.AppID, key), result)
}

// Notify sends a notification
func (pc *PluginContext) Notify(title, message, priority string) error {
	return pc.Client.SendNotification(NotificationPayload{
		Title:    title,
		Message:  message,
		Priority: priority,
	})
}

// Plugin is the base interface for IORA plugins
type Plugin interface {
	Execute(ctx context.Context, pluginCtx *PluginContext) (map[string]interface{}, error)
	OnInstall(ctx context.Context, pluginCtx *PluginContext) error
	OnUninstall(ctx context.Context, pluginCtx *PluginContext) error
	OnSettingsChanged(ctx context.Context, pluginCtx *PluginContext) error
}

// BasePlugin provides default implementations for plugin lifecycle methods
type BasePlugin struct{}

// OnInstall default implementation
func (bp *BasePlugin) OnInstall(ctx context.Context, pluginCtx *PluginContext) error {
	return nil
}

// OnUninstall default implementation
func (bp *BasePlugin) OnUninstall(ctx context.Context, pluginCtx *PluginContext) error {
	return nil
}

// OnSettingsChanged default implementation
func (bp *BasePlugin) OnSettingsChanged(ctx context.Context, pluginCtx *PluginContext) error {
	return nil
}

// DataProcessorPlugin is a base for data processor plugins
type DataProcessorPlugin struct {
	BasePlugin
}

// Process processes data (to be overridden by implementations)
func (dpp *DataProcessorPlugin) Process(ctx context.Context, pluginCtx *PluginContext, data interface{}) (interface{}, error) {
	return nil, fmt.Errorf("process method not implemented")
}

// Execute implements Plugin interface
func (dpp *DataProcessorPlugin) Execute(ctx context.Context, pluginCtx *PluginContext) (map[string]interface{}, error) {
	inputData := pluginCtx.InputData["data"]
	result, err := dpp.Process(ctx, pluginCtx, inputData)
	if err != nil {
		return nil, err
	}

	return map[string]interface{}{
		"result": result,
	}, nil
}

// AutomationPlugin is a base for automation plugins
type AutomationPlugin struct {
	BasePlugin
}

// OnEvent handles an event (to be overridden by implementations)
func (ap *AutomationPlugin) OnEvent(ctx context.Context, pluginCtx *PluginContext, event map[string]interface{}) error {
	return fmt.Errorf("onEvent method not implemented")
}

// Execute implements Plugin interface
func (ap *AutomationPlugin) Execute(ctx context.Context, pluginCtx *PluginContext) (map[string]interface{}, error) {
	event, ok := pluginCtx.InputData["event"].(map[string]interface{})
	if !ok {
		event = make(map[string]interface{})
	}

	if err := ap.OnEvent(ctx, pluginCtx, event); err != nil {
		return nil, err
	}

	return map[string]interface{}{
		"status": "completed",
	}, nil
}
