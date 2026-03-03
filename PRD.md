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

The design embodies modern minimalism with a timeless, sophisticated aesthetic. A full-screen photographic background creates immersive depth, while subtle glassmorphism provides elegant content separation without overwhelming the imagery. The interface is clean and uncluttered - every element serves a purpose. Typography is crisp and legible, with generous whitespace creating breathing room. The design transitions gracefully throughout the day, dimming the background image to match ambient lighting conditions. Interactions are refined and purposeful, with minimal but meaningful feedback.

## Color Selection

A refined, minimal color palette that prioritizes readability over photographic backgrounds with adaptive brightness for time-based themes.

- **Primary Color**: Subtle blue-gray `oklch(0.28 0.04 240)` - Clean, modern, unobtrusive
- **Foreground (Day)**: Near-white `oklch(0.95 0.005 240)` - High contrast over photography
- **Foreground (Night)**: Soft white `oklch(0.78 0.015 240)` - Readable but not harsh
- **Accent Color**: Refined cyan `oklch(0.55 0.15 220)` - Subtle highlights and interactions
- **Background Treatment**: Full-screen photography with CSS brightness filters (0.75 day, 0.6 evening, 0.4 night, 0.2 sleep)
- **Glass Effects**: Minimal blur (30px) with very low opacity (15-25%) to preserve background visibility
- **Gradients**: Subtle black gradient overlays (from-black/40 via-black/20 to-black/60) for text legibility

**Foreground/Background Pairings**:
- Day Mode: Near-white text `oklch(0.95 0.005 240)` on dimmed photo (brightness 0.75) - High contrast ✓
- Evening Mode: Soft white `oklch(0.85 0.01 250)` on darker photo (brightness 0.6) - Optimal ✓
- Night Mode: Muted white `oklch(0.78 0.015 240)` on dark photo (brightness 0.4) - Comfortable ✓
- Sleep Mode: Dim gray `oklch(0.25 0.015 240)` on black photo (brightness 0.2) - Minimal strain ✓
- Glass cards: 15-25% opacity with subtle borders for depth

## Font Selection

The typography should feel technical yet approachable, with excellent readability at all theme brightness levels.

- **Primary Font**: Inter - Clean, modern, excellent at all sizes with superb readability
- **Accent/Data Font**: JetBrains Mono - For sensor values, timestamps, and technical data to create visual distinction

**Typographic Hierarchy**:
- H1 (Greeting): Inter Normal/40px/tight leading
- H2 (Section Headers): Inter Medium/16px/normal tracking  
- Body (Context Text): Inter Regular/15px/relaxed leading/1.6
- Small (Labels): Inter Medium/12px/uppercase/wide tracking
- Timestamps: Inter Medium/14px/normal

## Animations

Animations are subtle and purposeful, enhancing usability without calling attention to themselves. Theme transitions use gentle 400ms ease timing for smooth atmospheric shifts between day/evening/night modes. The background image brightness animates fluidly to match time-based themes. Interactive elements have minimal hover states - no aggressive scaling or bouncing. Loading states are simple and unobtrusive. The overall feel is calm, refined, and distraction-free.

## Component Selection

- **Components**: 
  - Minimal glass cards with 12px border radius and 15-20% opacity
  - Photographic background with CSS filter brightness adjustments
  - Subtle gradient overlays for text legibility
  - Clean header with glassmorphism
  - Simple content layout with generous spacing
  - Weather widget with inline forecast strip

- **Customizations**: 
  - Refined glassmorphism: 30px blur, 15-25% opacity, subtle 8% borders
  - Full-screen background image with time-based brightness filters
  - Black gradient overlays (40% top, 20% middle, 60% bottom) for readability
  - Reduced border radius (0.75rem base) for cleaner, more minimal aesthetic
  - Fast 400ms theme transitions with ease timing
  - Large, light typography for maximum legibility over photos
  - Minimal decorative elements - focus on content and photography

- **States**: 
  - Minimal hover states - no aggressive transformations
  - Smooth opacity transitions for interactive elements
  - Simple loading indicator with icon
  - Clean focus states without heavy borders

- **Icon Selection**: 
  - @phosphor-icons/react with duotone weight for visual interest
  - Larger icons (40px) for weather and status indicators
  - Minimal use of icons - only where necessary
  - Check mark for confirmation/status

- **Spacing**: 
  - Generous whitespace for breathing room
  - Card padding: 5 (20px)
  - Section gaps: 6 (24px)
  - Rounded corners: xl (12px) for cards
  - Compact inline spacing for forecast elements

- **Mobile**: 
  - Single column stacking
  - Maintained generous padding
  - Background image scales appropriately
  - Same minimal aesthetic on all screen sizes
