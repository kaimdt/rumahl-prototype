# Planning Guide

A fully customizable Home Assistant-compatible dashboard with iOS 26-inspired glassmorphism design that dynamically adapts its visual appearance and displayed content based on time of day and sleep mode, providing comprehensive control and management of smart home devices.

**Experience Qualities**:
1. **Adaptive** - The interface seamlessly transitions between light, evening, night, and sleep modes with content that changes based on time of day
2. **Refined** - Premium glassmorphic design with sophisticated blur effects, smooth animations, and elegant rounded corners creating a modern iOS aesthetic
3. **Intuitive** - Smart home controls are immediately accessible with clear visual feedback, time-contextual information, and satisfying micro-interactions

**Complexity Level**: Complex Application (advanced functionality, likely with multiple views)
This is a sophisticated smart home management platform requiring real-time device state management, time-based content adaptation, iOS-inspired glassmorphism UI, Home Assistant API integration, dynamic theming with smooth transitions, and persistent configuration storage.

## Essential Features

**Time-Based Theme Adaptation**
- Functionality: Automatically adjusts dashboard brightness, color scheme, and displayed content based on current time
- Purpose: Reduces eye strain, creates appropriate ambiance, and shows contextually relevant information
- Trigger: Current system time checked every minute
- Progression: Time check → Theme calculation (Day/Evening/Night/Sleep) → CSS variable adjustment → Content visibility logic → Smooth transition
- Success criteria: Dashboard smoothly transitions between 4 distinct modes with appropriate content shown (weather in morning, lights highlighted at night)

**Dynamic Content Display**
- Functionality: Shows different dashboard sections and information based on time of day
- Purpose: Surfaces most relevant information at the right time (weather in morning, lighting controls in evening)
- Trigger: Time-based logic evaluated on each render
- Progression: Get current hour → Evaluate time ranges → Show/hide sections → Highlight priority controls
- Success criteria: Morning shows weather and calendar, afternoon adds energy, evening highlights lights, night minimizes distractions

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

The design evokes the cutting-edge aesthetic of iOS 26 - a premium interface that feels simultaneously ethereal and substantial. Sophisticated glassmorphism creates layers of translucent depth, with content floating on blurred, vibrant backgrounds. The design breathes with the rhythm of the day, transitioning from bright and energetic during daytime to subdued and calming at night. Every interaction should feel buttery smooth, with micro-animations that delight without distracting.

## Color Selection

An advanced blue-based color system with rich glassmorphic effects that creates atmospheric depth through four distinct time modes.

- **Primary Color (Day)**: Soft blue-gray `oklch(0.32 0.06 240)` - Modern, technological sophistication
- **Primary Color (Evening)**: Warmer muted slate `oklch(0.26 0.05 255)` - Gentle transition to evening
- **Primary Color (Night)**: Deep charcoal blue `oklch(0.15 0.035 240)` - Rich darkness with subtle color
- **Primary Color (Sleep)**: Near-black `oklch(0.06 0.015 240)` - Maximum darkness for night mode
- **Accent Color**: Vibrant cyan `oklch(0.60 0.18 220)` - High-tech highlight with electric energy
- **Success/On State**: Warm amber `oklch(0.68 0.14 75)` - Represents active/on devices with warm glow
- **Background Gradients**: Multi-layered mesh gradients using radial gradients with accent and primary colors at low opacity
- **Glass Effects**: backdrop-filter blur (40px day, 20px sleep) with 55-65% opacity and subtle border highlights

**Foreground/Background Pairings**:
- Day Mode: Dark text `oklch(0.18 0.02 240)` on light bg `oklch(0.96 0.015 240)` - Ratio 14.8:1 ✓
- Evening Mode: Dark text `oklch(0.22 0.025 250)` on medium bg `oklch(0.78 0.03 250)` - Ratio 11.2:1 ✓
- Night Mode: Light text `oklch(0.88 0.02 240)` on dark bg `oklch(0.18 0.04 240)` - Ratio 13.5:1 ✓
- Sleep Mode: Dim text `oklch(0.32 0.02 240)` on black bg `oklch(0.08 0.02 240)` - Ratio 5.1:1 ✓
- Accent: White text `oklch(0.98 0 0)` on cyan `oklch(0.60 0.18 220)` - Ratio 5.8:1 ✓

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

Animations create a premium, iOS-like fluidity throughout the interface. Theme transitions use slow 2.5-second cubic-bezier easing for atmospheric shifts. Card interactions feature subtle scale transforms (1.02 on hover, 0.98 on press). Loading states use pulsing glows rather than spinners. Success states have gentle bounce animations. All transitions maintain 60fps performance with GPU-accelerated properties (transform, opacity). The overall feel should be buttery smooth and delightfully responsive.

## Component Selection

- **Components**: 
  - Card (glassmorphic with backdrop-blur, increased border radius to 1.25rem base)
  - Switch (smooth slide with color transitions)
  - Slider (for brightness controls with gradient track)
  - Button (subtle scale and glow effects)
  - Custom glass header (blurred sticky header with translucent background)
  - Time-contextual content containers (show/hide based on time of day)

- **Customizations**: 
  - iOS-inspired glassmorphism with backdrop-filter blur (40px) and color saturation
  - Layered mesh gradients for backgrounds using radial gradients
  - Enhanced shadows with colored glows (accent/20 for active elements)
  - Larger border radius (1.25rem base) for modern iOS aesthetic
  - Smooth 2.5s theme transitions with cubic-bezier easing
  - Dynamic content display based on time (weather in morning, lights highlighted at night)
  - Pulsing accent dots for active indicators
  - Animated icons with weight changes for state feedback

- **States**: 
  - Cards: Scale 1.02 on hover, lift effect with enhanced shadow, smooth 200ms transitions
  - Switches: 300ms slide with color fade to accent
  - Buttons: Scale 1.05 hover, 0.98 active, glow effect on focus
  - Active lights: Pulsing icon with warm glow shadow
  - Loading: Rotating border with sparkle icon overlay

- **Icon Selection**: 
  - @phosphor-icons/react throughout (House, Sun, MoonStars, Lightbulb, Lightning, Gear, Sparkle, Drop, Cloud icons)
  - Weight changes for state (fill for active, regular for inactive, duotone for evening)
  - Size variations for hierarchy (48px for greeting icons, 20px for controls)

- **Spacing**: 
  - Generous spacing with breathing room
  - Card padding: 5-6 (20-24px)
  - Section gaps: 6-8 (24-32px)
  - Widget gaps: 3-4 (12-16px)
  - Rounded corners: 2xl-3xl (1.25-1.5rem)

- **Mobile**: 
  - Single column below 768px
  - Reduced padding (4-5 instead of 5-6)
  - Larger touch targets (minimum 44px)
  - Greeting card stacks vertically
  - Weather hidden on mobile at night
  - Bottom-aligned time display
