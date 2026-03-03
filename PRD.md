# Planning Guide

A fully customizable Home Assistant-compatible dashboard that adapts its visual appearance based on time of day and sleep mode, providing comprehensive control and management of smart home devices.

**Experience Qualities**:
1. **Adaptive** - The interface seamlessly transitions between light, evening, night, and sleep modes based on time and user preferences
2. **Intuitive** - Smart home controls are immediately accessible with clear visual feedback for all device states
3. **Personalized** - Every aspect of the dashboard is customizable, from layout to component placement and configuration

**Complexity Level**: Complex Application (advanced functionality, likely with multiple views)
This is a sophisticated smart home management platform requiring real-time device state management, customizable layouts, multiple view types, Home Assistant API integration, dynamic theming, and persistent configuration storage.

## Essential Features

**Time-Based Theme Adaptation**
- Functionality: Automatically adjusts dashboard brightness and color scheme based on current time
- Purpose: Reduces eye strain and creates appropriate ambiance for different times of day
- Trigger: Current system time or Home Assistant time sensor
- Progression: Time check → Theme calculation (Day/Evening/Night/Sleep) → CSS variable adjustment → Smooth transition
- Success criteria: Dashboard smoothly transitions between 4 distinct brightness levels without jarring changes

**Home Assistant Entity Display**
- Functionality: Shows all Home Assistant entities (lights, switches, sensors, climate, media players, etc.)
- Purpose: Provides real-time visibility into all smart home device states
- Trigger: Dashboard load and periodic polling/WebSocket updates
- Progression: Connect to HA API → Fetch entities → Parse by domain → Render appropriate controls → Update on state change
- Success criteria: All entity types display correctly with real-time state updates

**Device Control Interface**
- Functionality: Toggle switches, adjust lights, control climate, manage media players
- Purpose: Enables direct interaction with smart home devices
- Trigger: User interaction with any control element
- Progression: User action → API call to Home Assistant → State update → UI feedback → Confirmation
- Success criteria: Controls respond instantly with visual feedback, state persists correctly

**Customizable Dashboard Layout**
- Functionality: Drag-and-drop interface for arranging widgets and components
- Purpose: Allows users to create personalized dashboard layouts matching their needs
- Trigger: Edit mode activation
- Progression: Enable edit mode → Drag widgets → Drop in grid → Save configuration → Persist to storage
- Success criteria: Layout changes save and restore on reload, all positions maintained

**Weather Integration**
- Functionality: Display current weather and forecast from Home Assistant weather entity
- Purpose: Provides at-a-glance weather information as shown in reference design
- Trigger: Dashboard load and periodic updates
- Progression: Fetch weather entity → Parse conditions → Display temperature, forecast, conditions → Update hourly
- Success criteria: Weather displays accurately with multi-day forecast

**Personalized Greeting**
- Functionality: Shows time-appropriate greeting with user name and contextual information
- Purpose: Creates welcoming, personalized experience
- Trigger: Dashboard load
- Progression: Get user name → Check time → Generate greeting → Fetch relevant info (calendar, weather) → Display
- Success criteria: Greeting updates based on time of day and shows relevant contextual data

## Edge Case Handling

- **Connection Loss**: Display offline indicator, queue actions, retry connection, show cached state
- **Invalid Entities**: Gracefully handle missing or misconfigured entities with placeholder cards
- **Empty Dashboard**: Show welcome screen with setup guide for first-time users
- **Sleep Mode Override**: Manual toggle available regardless of time for shift workers or custom schedules
- **Slow API Response**: Show loading states, implement optimistic updates for controls
- **Mobile/Tablet Views**: Responsive grid system that adapts to different screen sizes

## Design Direction

The design should evoke a sense of calm sophistication and technological refinement - a premium smart home interface that feels both powerful and serene. The aesthetic should be modern and minimal, with an emphasis on clarity and atmosphere. Time-based theming creates an ambient quality that the interface breathes with the rhythm of the day.

## Color Selection

A sophisticated blue-gray color system that transitions through four distinct modes while maintaining excellent readability.

- **Primary Color (Day)**: Deep slate blue `oklch(0.35 0.05 240)` - Communicates technological sophistication and reliability
- **Primary Color (Evening)**: Warmer muted blue `oklch(0.28 0.04 250)` - Softer transition as day winds down
- **Primary Color (Night)**: Very dark blue-gray `oklch(0.18 0.03 240)` - Deep but not completely black for comfort
- **Primary Color (Sleep)**: Near-black `oklch(0.08 0.02 240)` - Maximum darkness while maintaining subtle color
- **Accent Color**: Vibrant cyan `oklch(0.65 0.15 210)` - High-tech highlight for active controls and important elements
- **Success/On State**: Warm amber `oklch(0.70 0.12 70)` - Represents active/on devices (like warm lights)
- **Background Transitions**: Day `oklch(0.98 0.01 240)` → Evening `oklch(0.85 0.02 245)` → Night `oklch(0.22 0.03 240)` → Sleep `oklch(0.10 0.02 240)`

**Foreground/Background Pairings**:
- Day Mode: Dark text `oklch(0.20 0.02 240)` on light bg `oklch(0.98 0.01 240)` - Ratio 13.2:1 ✓
- Evening Mode: Dark text `oklch(0.25 0.02 245)` on medium bg `oklch(0.85 0.02 245)` - Ratio 9.8:1 ✓
- Night Mode: Light text `oklch(0.85 0.02 240)` on dark bg `oklch(0.22 0.03 240)` - Ratio 11.5:1 ✓
- Sleep Mode: Dim text `oklch(0.35 0.02 240)` on black bg `oklch(0.10 0.02 240)` - Ratio 4.9:1 ✓
- Accent: White text `oklch(0.98 0 0)` on cyan `oklch(0.65 0.15 210)` - Ratio 5.2:1 ✓

## Font Selection

The typography should feel technical yet approachable, with excellent readability at all theme brightness levels.

- **Primary Font**: Inter - Clean, modern, excellent at all sizes with superb readability
- **Accent/Data Font**: JetBrains Mono - For sensor values, timestamps, and technical data to create visual distinction

**Typographic Hierarchy**:
- H1 (Greeting): Inter SemiBold/32px/tight tracking/-0.02em
- H2 (Section Headers): Inter Medium/20px/normal tracking
- H3 (Card Titles): Inter Medium/16px/normal tracking
- Body (Descriptions): Inter Regular/14px/relaxed leading/1.6
- Data (Sensor Values): JetBrains Mono Medium/18px/tabular numbers
- Small (Labels): Inter Regular/12px/uppercase/wide tracking/0.05em

## Animations

Animations should emphasize the fluidity of state changes and theme transitions, creating an ambient, breathing quality to the interface. Smooth transitions between themes (3-5 second fade), instant feedback on control interactions (100ms), gentle pulsing for loading states, and satisfying confirmation animations for successful actions.

## Component Selection

- **Components**: 
  - Card (base for all widgets with glassmorphic backdrop-blur effects)
  - Switch (for on/off controls)
  - Slider (for dimmers and temperature controls)
  - Button (for actions and toggles)
  - Dialog (for entity details and settings)
  - Tabs (for multi-page navigation)
  - ScrollArea (for long entity lists)
  - Popover (for quick settings)
  - Skeleton (for loading states)

- **Customizations**: 
  - Custom grid layout component with drag-drop using framer-motion
  - Entity-specific widgets (LightCard, ClimateCard, MediaCard, SensorCard)
  - Time-of-day theme provider with smooth CSS variable transitions
  - Home Assistant connection manager component
  - Custom weather widget matching reference design

- **States**: 
  - Buttons: Subtle scale on hover (1.02), pressed state (0.98), glow effect for active states
  - Switches: Smooth slide transition (200ms), color change to accent when on
  - Cards: Lift on hover with subtle shadow, highlight border for selected/editing
  - Inputs: Focus state with accent glow, validation feedback

- **Icon Selection**: 
  - @phosphor-icons/react for all UI controls
  - Sun/MoonStars for time mode indicators
  - Lightning for power/energy
  - Thermometer for climate
  - Speaker for media
  - Gear for settings
  - GridFour for layout customization

- **Spacing**: 
  - Base unit: 4px (Tailwind default)
  - Card padding: 6 (24px)
  - Section gaps: 6 (24px)
  - Widget gaps: 4 (16px)
  - Tight spacing: 2 (8px)

- **Mobile**: 
  - Single column layout below 768px
  - Collapsible sidebar for navigation
  - Larger touch targets (min 44px)
  - Simplified greeting section
  - Swipeable between pages
  - Bottom navigation for primary actions
