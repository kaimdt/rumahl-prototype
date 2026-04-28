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

**Light Control Panels**
- Functionality: Display all light entities with toggle switches, brightness sliders, and RGB color control
- Purpose: Provides comprehensive control over all lighting in the home including color customization
- Trigger: Dashboard load, real-time updates, and long-press gestures
- Progression: Fetch light entities → Render cards with on/off state → Show brightness slider when on → Tap to toggle → Hold to open full control dialog → Adjust brightness via drag → Select colors via color picker → API call → Update state
- Success criteria: Lights toggle instantly with haptic feedback, brightness adjusts smoothly with tactile response, color picker enables full RGB selection with real-time preview, visual states match actual device states

**Climate Control Panels**
- Functionality: Monitor and adjust heating/cooling systems with temperature controls and mode switching
- Purpose: Enables climate management with current and target temperature display
- Trigger: Dashboard load and periodic updates
- Progression: Fetch climate entities → Display current/target temps → User adjusts via +/- buttons or mode selector → API call → Update display
- Success criteria: Temperature changes are responsive, mode icons update correctly, HVAC action status displays accurately

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

**Haptic Feedback System**
- Functionality: Provides tactile feedback for different interaction patterns across all controls
- Purpose: Enhances user experience with physical confirmation of actions on supported devices
- Trigger: All user interactions with controls (taps, drags, toggles, color selections)
- Progression: User interaction → Detect interaction type → Trigger appropriate haptic pattern → Provide tactile confirmation
- Success criteria: Light taps for selections, medium impacts for toggles, heavy impacts for long presses, success/error notifications for API responses, seamless degradation on unsupported devices

## Edge Case Handling

- **Connection Loss**: Display offline indicator, queue actions, retry connection, show cached state
- **Invalid Entities**: Gracefully handle missing or misconfigured entities with placeholder cards
- **Empty Dashboard**: Show welcome screen with setup guide for first-time users
- **Sleep Mode Override**: Manual toggle available regardless of time for shift workers or custom schedules
- **Slow API Response**: Show loading states, implement optimistic updates for controls
- **Mobile/Tablet Views**: Responsive grid system that adapts to different screen sizes
- **Unsupported Color Modes**: Automatically detect light capabilities and show appropriate controls (RGB, color temperature, or brightness only)
- **No Haptic Support**: Gracefully degrade to visual-only feedback on devices without vibration API

## Design Direction

The design embodies modern minimalism with a timeless, sophisticated aesthetic. A full-screen photographic background creates immersive depth, while subtle glassmorphism provides elegant content separation without overwhelming the imagery. The interface is clean and uncluttered - every element serves a purpose. Typography is crisp and legible, with generous whitespace creating breathing room. The design transitions gracefully throughout the day, dimming the background image to match ambient lighting conditions. Interactions are refined and purposeful, with minimal but meaningful feedback.

## Color Selection

A refined, vibrant color palette with modern iOS-inspired tones that create depth and visual interest while maintaining readability.

- **Primary Color**: Subtle blue-gray `oklch(0.28 0.04 240)` - Clean, modern, unobtrusive
- **Foreground (Day)**: Near-white `oklch(0.95 0.005 240)` - High contrast over photography
- **Foreground (Night)**: Soft white `oklch(0.78 0.015 240)` - Readable but not harsh
- **Accent Color**: Vibrant cyan-blue `oklch(0.65 0.20 210)` - Eye-catching highlights for interactive elements
- **Success Color**: Fresh green `oklch(0.68 0.18 140)` - Positive feedback and light controls
- **Background Treatment**: Full-screen photography with CSS brightness filters (0.75 day, 0.6 evening, 0.4 night, 0.2 sleep)
- **Glass Effects**: Enhanced blur (40px) with increased opacity (25-35%) and color tinting for depth
- **Glass Tints**: Dynamic color overlays that shift per theme (cool blue for day, purple-blue for evening/night)
- **Gradients**: Subtle black gradient overlays (from-black/40 via-black/20 to-black/60) for text legibility

**Foreground/Background Pairings**:
- Day Mode: Near-white text `oklch(0.95 0.005 240)` on dimmed photo (brightness 0.75) - High contrast ✓
- Evening Mode: Soft white `oklch(0.85 0.01 250)` on darker photo (brightness 0.6) - Optimal ✓
- Night Mode: Muted white `oklch(0.78 0.015 240)` on dark photo (brightness 0.4) - Comfortable ✓
- Sleep Mode: Dim gray `oklch(0.25 0.015 240)` on black photo (brightness 0.2) - Minimal strain ✓
- Glass cards: 25-35% opacity with gradient color tints and enhanced saturation (1.8x) for vibrancy

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

Animations are purposeful and refined, creating a premium iOS-like experience. Theme transitions use gentle 400ms ease timing for smooth atmospheric shifts between day/evening/night modes. The background image brightness animates fluidly to match time-based themes. Interactive elements have iOS-inspired feedback - sliders feature smooth scaling on interaction (110% hover, 95% active), and tab switches animate with subtle glass-effect transitions. Slider thumbs have layered shadow effects that respond to interaction states. The overall feel is polished, fluid, and distinctly Apple-like in its attention to micro-interactions.

## Component Selection

- **Components**: 
  - Vibrant glass cards with 12px border radius, 25-35% opacity, and gradient color tints
  - iOS-style sliders with refined thumbs featuring inset shadows and subtle glow effects
  - Modern tab controls with glass-effect active states (gradient backgrounds with borders)
  - Photographic background with CSS filter brightness adjustments
  - Enhanced gradient overlays for text legibility with color saturation boost
  - Clean header with premium glassmorphism
  - Simple content layout with generous spacing
  - Weather widget with inline forecast strip
  - Light control cards with toggle switches, iOS-style brightness sliders, and RGB color pickers
  - Interactive color picker with HSV canvas, hue slider, preset swatches, and live preview
  - Premium tabbed interface for color vs. temperature control with glass-effect active states
  - Climate control cards with temperature displays and mode selectors

- **Customizations**: 
  - Premium glassmorphism: 40px blur, 25-35% opacity, gradient color tints, 1.8x saturation boost
  - Full-screen background image with time-based brightness filters
  - Black gradient overlays (40% top, 20% middle, 60% bottom) for readability
  - Reduced border radius (0.75rem base) for cleaner, more minimal aesthetic
  - Fast 400ms theme transitions with ease timing
  - Large, light typography for maximum legibility over photos
  - Minimal decorative elements - focus on content and photography
  - Custom HSV color picker with canvas-based saturation/value selector
  - Haptic vibration patterns for different interaction types
  - iOS-inspired slider thumbs with layered shadows (outer drop shadow + inner highlight)
  - Gradient-based slider tracks with vibrant accent colors
  - Active tab states with glass effect (gradient background, borders, inset highlights)

- **States**: 
  - Minimal hover states - no aggressive transformations
  - Smooth opacity transitions for interactive elements
  - Simple loading indicator with icon
  - Clean focus states without heavy borders
  - Light cards show active/on state with colored icon backgrounds
  - Climate cards display heating/cooling states with appropriate colors
  - Disabled states for controls during API calls
  - Dragging state with visual brightness feedback on light cards
  - Color picker shows real-time preview during adjustment
  - Haptic feedback confirms all interactions (light/medium/heavy impacts, success/error notifications)

- **Icon Selection**: 
  - @phosphor-icons/react with duotone weight for visual interest
  - Larger icons (40px) for weather and status indicators
  - Minimal use of icons - only where necessary
  - Check mark for confirmation/status
  - Lightbulb icons for light controls (filled when on, regular when off)
  - Flame/Snowflake/Fan icons for climate modes (heat/cool/auto)
  - Lightning bolt for brightness indicators
  - Thermometer for temperature displays
  - Palette icon for color controls
  - Arrows for drag gesture indicators

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
  - Touch-optimized color picker with drag support
  - Haptic feedback on all touch interactions
