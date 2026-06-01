# Settings Schema Guide

Apps can define a settings schema in their manifest to provide user-configurable options. IORA automatically generates a settings UI based on this schema.

## Defining a Settings Schema

```json
{
  "settings_schema": {
    "title": "App Settings",
    "description": "Configure your app preferences",
    "sections": [
      {
        "title": "General",
        "description": "Basic app settings",
        "fields": [...]
      },
      {
        "title": "Advanced",
        "description": "Advanced configuration",
        "collapsed": true,
        "fields": [...]
      }
    ],
    "fields": [
      {
        "key": "api_key",
        "label": "API Key",
        "type": "password",
        "required": true,
        "description": "Your API key for the external service"
      }
    ]
  }
}
```

## Field Types

### Text

```json
{
  "key": "display_name",
  "label": "Display Name",
  "type": "text",
  "default": "My App",
  "placeholder": "Enter a name",
  "max_length": 50,
  "required": true
}
```

### Textarea

```json
{
  "key": "description",
  "label": "Description",
  "type": "textarea",
  "default": "",
  "placeholder": "Enter description",
  "max_length": 500,
  "rows": 4
}
```

### Number

```json
{
  "key": "refresh_interval",
  "label": "Refresh Interval (seconds)",
  "type": "number",
  "default": 60,
  "validation": {
    "min": 10,
    "max": 3600
  },
  "unit": "seconds"
}
```

### Boolean (Toggle)

```json
{
  "key": "enable_notifications",
  "label": "Enable Notifications",
  "type": "boolean",
  "default": true
}
```

### Select (Dropdown)

```json
{
  "key": "theme",
  "label": "Theme",
  "type": "select",
  "default": "dark",
  "options": [
    { "value": "dark", "label": "Dark" },
    { "value": "light", "label": "Light" },
    { "value": "auto", "label": "Auto (follow system)" }
  ]
}
```

### Password

```json
{
  "key": "api_key",
  "label": "API Key",
  "type": "password",
  "required": true,
  "description": "Stored encrypted, never shown in plain text"
}
```

### URL

```json
{
  "key": "server_url",
  "label": "Server URL",
  "type": "url",
  "default": "https://api.example.com",
  "placeholder": "https://",
  "validation": {
    "pattern": "^https://",
    "pattern_message": "URL must start with https://"
  }
}
```

### Email

```json
{
  "key": "contact_email",
  "label": "Contact Email",
  "type": "email",
  "required": false
}
```

### Color Picker

```json
{
  "key": "accent_color",
  "label": "Accent Color",
  "type": "color",
  "default": "#3B82F6"
}
```

### Entity Selector

```json
{
  "key": "target_entity",
  "label": "Target Entity",
  "type": "entity",
  "entity_domain": "light",     // Filter by domain
  "entity_multiple": false,      // Single selection
  "description": "Select the light to control"
}
```

### Multi-Entity Selector

```json
{
  "key": "monitored_entities",
  "label": "Monitored Entities",
  "type": "entity",
  "entity_domain": "sensor",
  "entity_multiple": true,      // Multiple selection
  "min_selection": 1,
  "max_selection": 10
}
```

## Field Properties

| Property | Type | Description |
|----------|------|-------------|
| `key` | string | Unique identifier (used in API) |
| `label` | string | Display label |
| `type` | string | Field type (see above) |
| `default` | any | Default value |
| `required` | boolean | Whether the field is required |
| `description` | string | Help text shown below the field |
| `placeholder` | string | Placeholder text |
| `validation` | object | Validation rules |
| `options` | array | Options for `select` type |
| `depends_on` | object | Conditional visibility |

## Validation Rules

```json
{
  "validation": {
    "min": 10,
    "max": 3600,
    "pattern": "^[a-zA-Z0-9_]+$",
    "pattern_message": "Only letters, numbers, and underscores allowed",
    "min_length": 3,
    "max_length": 50
  }
}
```

## Conditional Fields

Show/hide fields based on other field values:

```json
{
  "key": "use_custom_server",
  "label": "Use Custom Server",
  "type": "boolean",
  "default": false
},
{
  "key": "custom_server_url",
  "label": "Custom Server URL",
  "type": "url",
  "depends_on": {
    "field": "use_custom_server",
    "value": true
  }
}
```

## Sections

Group related fields:

```json
{
  "sections": [
    {
      "title": "Connection",
      "description": "Server connection settings",
      "icon": "plug",
      "fields": [
        { "key": "server_url", "label": "Server URL", "type": "url" },
        { "key": "api_key", "label": "API Key", "type": "password" }
      ]
    },
    {
      "title": "Display",
      "description": "Visual settings",
      "icon": "palette",
      "collapsed": true,
      "fields": [
        { "key": "theme", "label": "Theme", "type": "select" },
        { "key": "accent_color", "label": "Accent Color", "type": "color" }
      ]
    }
  ]
}
```

## Accessing Settings in Your App

### API

```http
# Get settings schema
GET /api/apps/{app_id}/config/schema

# Get current settings (with defaults)
GET /api/apps/{app_id}/config

# Update settings
PUT /api/apps/{app_id}/config
Content-Type: application/json

{
  "api_key": "new-key",
  "refresh_interval": 120
}
```

### SDK

```javascript
const client = new IoraClient('http://localhost:8126', 'api-key');
client.setAppId('my-app');

// Get current settings
const config = await client.appConfig.get();
console.log(config.api_key, config.refresh_interval);

// Update settings
await client.appConfig.update({
  api_key: 'new-value',
  refresh_interval: 120
});

// Reset a setting to default
await client.appConfig.reset('api_key');
```

## Best Practices

1. **Provide sensible defaults** – Users shouldn't need to configure everything
2. **Use descriptive labels and help text** – Explain what each setting does
3. **Group related settings in sections** – Improves usability
4. **Validate on the server too** – Don't trust client-side validation alone
5. **Mark required fields clearly** – Don't surprise users with validation errors
6. **Use conditional fields** – Hide irrelevant options
7. **Store secrets as `password` type** – They're encrypted in iora-secrets
8. **Keep it simple** – Too many settings overwhelm users

## Complete Example

```json
{
  "settings_schema": {
    "title": "Weather App Settings",
    "description": "Configure your weather display preferences",
    "sections": [
      {
        "title": "Location",
        "icon": "map-pin",
        "fields": [
          {
            "key": "city",
            "label": "City",
            "type": "text",
            "default": "Berlin",
            "required": true
          },
          {
            "key": "units",
            "label": "Temperature Units",
            "type": "select",
            "default": "metric",
            "options": [
              { "value": "metric", "label": "Celsius (°C)" },
              { "value": "imperial", "label": "Fahrenheit (°F)" }
            ]
          }
        ]
      },
      {
        "title": "Display",
        "icon": "palette",
        "collapsed": true,
        "fields": [
          {
            "key": "refresh_interval",
            "label": "Update Interval",
            "type": "number",
            "default": 300,
            "validation": { "min": 60, "max": 3600 },
            "unit": "seconds"
          },
          {
            "key": "show_humidity",
            "label": "Show Humidity",
            "type": "boolean",
            "default": true
          },
          {
            "key": "accent_color",
            "label": "Widget Color",
            "type": "color",
            "default": "#3B82F6"
          }
        ]
      }
    ]
  }
}
```

## Related Documentation

- [App Development Guide](../development/app-development.md) – Full manifest reference
- [App Configuration API](../api/core.md#app-configuration) – API endpoints
- [Plugin Development Guide](../development/plugin-development.md) – Plugin settings
