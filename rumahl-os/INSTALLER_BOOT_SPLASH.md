# rumahl OS Installer — Boot Splash, Wizard UI and Recovery Shell

This document describes the rumahl OS installer's boot splash, the
first-boot progress TUI and the recovery-shell command suite.

## Boot Splash Screen

### Overview

When the rumahl OS installer boots, instead of a black screen the user
sees a branded boot screen:

- **rumahl wordmark** in the rumahl accent color (256-color, ~#2563eb)
- **Tagline** "Interface for Optimized Residential Autonomy"
- **Animated loading spinner** with a live status line
- **[ OK ] completion marker** and a recovery-shell hint

### Visual Example

```
           ___    ___    _____      _
          |_ _|  / _ \  |  __ \    / \
           | |  | | | | | |__) |  / _ \
           | |  | | | | |  _  /  / ___ \
          |___|  \___/  |_| \_\ /_/   \_\

        Interface for Optimized Residential Autonomy

        Starting rumahl OS Installer
        | Loading system components...            <- animated
        [ OK ] System ready

        Recovery shell: install | sysinfo | netsetup
```

### Technical Details

**Implementation**: `init_extracted.sh` — `show_boot_splash()`.

**Palette (256-color SGR)** — mirrors the dashboard accent so the
console and web UI share one identity:

```sh
ACCENT='\033[38;5;39m'    # ~#2563eb  (wordmark)
CYAN='\033[38;5;45m'      # spinner
WHITE='\033[1;97m'        # status headline
GREEN='\033[38;5;42m'     # [ OK ]
GRAY='\033[38;5;245m'     # tagline / hints
```

Consoles without 256-color support degrade to the nearest 16-color
match automatically.

**IMPORTANT — pure 7-bit ASCII only.** The kernel framebuffer console
with the default VGA font does **not** render UTF-8 box-drawing or
Braille glyphs (`╔═╗ • ✓ ⠋` …) — they show up as mojibake. All splash
and shell output is therefore restricted to 7-bit ASCII. The `dialog(1)`
wizard dialogs are exempt because dialog renders its own ACS border
glyphs internally.

### Spinner

Four-frame ASCII spinner (`|/-\`), driven with a `printf %s` argument
so the backslash frame does not collide with the trailing color escape:

```sh
printf "\r        ${CYAN}%s${RESET} Loading system components..." "$char"
```

### Cursor handling

The cursor is hidden during the splash (`\033[?25l`) and restored
before the wizard starts (`\033[?25h`).

## Wizard UI (dialog)

The installer wizard uses `dialog(1)` (falls back to `whiptail`, then
to plain text prompts). A modern **dark theme** is installed via
`/tmp/.dialogrc` (`setup_dialog_theme()` in `init_extracted.sh`):

- Black canvas (`screen_color = (WHITE,BLACK,ON)`)
- rumahl blue borders and selection (`BLUE`) — approximates the web accent
- Cyan titles, yellow highlights and gauge, green scroll arrows

## First-Boot Progress Display (local GUI or console TUI)

On first boot the setup progress is shown locally on tty1 by
`rumahl-setup-display.service`, which picks the best available surface:

- **Graphical GUI** (`rumahl-setup-gui.py`) when a framebuffer is present
  (`/dev/fb0` — HDMI display attached). It draws a branded screen
directly on the framebuffer: navy gradient, the rumahl hexagon mark,
wordmark, a status card with live progress bar + phase + log tail, the
setup URL, and a completion screen with the dashboard URL.
- **Console TUI** (`rumahl-setup-tui`, Python) as fallback when no
display is attached. It also keeps its interactive static-IP prompt
(`[N]` when no DHCP address appears) — the GUI has no keyboard input,
so on headless/static-IP setups the TUI remains the way to configure
networking from the device itself.

Both read the same `setup-state.json` written by the setup server, so
the local screen and the web wizard always agree. The GUI renders in
bulk scanlines (a 1080p frame takes ~1 s on the device-class CPU) and
only redraws when the state actually changes. On completion it exits
with code 0 and `ExecStopPost` hands tty1 back to `getty@tty1.service`.

The GUI has a test mode that renders one frame to a PPM file without a
framebuffer (used for development/verification):

```sh
python3 rumahl-setup-gui.py --ppm /tmp/frame.ppm --size 1920x1080 [--state /path/state.json]
```

## First-Boot Setup — Two Flows

rumahl OS has **two deployment paths**, and the first-boot setup adapts to
the path automatically via `/etc/ora/setup-config.json`:

1. **Installer flow** (CD/USB): the installer wizard collects every answer
   — hostname, network, timezone, root password, **web-admin account** and
   **locale** (language/country/units) — and writes a
   `setup-config.json` into the target. On first boot
   `rumahl-setup.service` detects the file and applies it **headlessly**
   (`setup-server.py --apply-config`): DB credentials + secrets, admin
   bootstrap, docker-compose, completion flags. The interactive web
   wizard is **never shown**; the dashboard is ready immediately. The
   Recovery PIN generated during the apply is shown on the local display.
2. **Flash flow** (image written directly to SD/eMMC — Raspberry Pi etc.):
   no config file exists, so `rumahl-setup.service` starts the interactive
   **web wizard** on port 8080 exactly as before.

The single unit (`rumahl-setup.service` → `rumahl-setup-run.sh`) decides
which path to take; the headless apply reuses the same `apply_config()`
engine as the wizard, so both paths behave identically.

## Setup Web GUI (browser)

The full graphical setup wizard is served by `setup-server.py` at
`http://<IP>:8080/setup` (flash path; the TUI/GUI points the user there).
It is a 5-step wizard (system check → configuration → disk/LUKS → apply →
Recovery PIN/dashboard) styled with the rumahl design tokens
(`--primary: #2563eb` etc.): dark theme, cards, toggles, live apply
progress with log pane, animated step transitions and soft keyboard
focus rings.

## Plymouth (Graphical Boot Splash)

For systems with framebuffer support, Plymouth is compiled in
(`BR2_PACKAGE_PLYMOUTH=y`) and an rumahl theme ships in:

```
board/rumahl/rootfs-overlay/usr/share/plymouth/themes/rumahl/
├── rumahl.plymouth    # theme descriptor
└── rumahl.script      # dark navy bg, wordmark label, tagline, progress bar
```

The script theme renders:

- Dark navy background
- **`logo.png`** (ships in this directory, 480x112 transparent PNG:
  brand mark + wordmark) — falls back to a text label if removed
- Tagline "Your Home. Your Control."
- A boot progress bar fed by Plymouth's progress events

To rebrand, replace `logo.png` (wide and short, transparent background)
and rebuild.

## Recovery Shell and CLI Commands

After the wizard exits (cancel or completion) the user lands in a
recovery shell with the following commands (`/bin/*`):

| Command     | Description                              | Alias   |
|-------------|------------------------------------------|---------|
| `install`   | Restart the rumahl OS installation wizard  | `installer` |
| `sysinfo`   | Display CPU, memory, boot mode, disks, network | —  |
| `netsetup`  | Configure network interfaces via DHCP    | —       |
| `help`      | Show all available commands              | —       |
| `reboot`    | Reboot the system                        | —       |
| `poweroff`  | Shut down the system                     | —       |

All helper scripts use ASCII frames and the same 256-color palette;
`netsetup` reports `[ OK ]` / `[FAIL]` instead of Unicode glyphs so the
output stays readable on framebuffer consoles.

### Returning to the Wizard

```sh
install          # or: installer
```

Both restart `/init` (splash + wizard).

## Customization

### Changing the Boot Splash Logo

Edit `show_boot_splash()` in `init_extracted.sh` — the wordmark is a
quoted heredoc inside the function. Keep it pure ASCII.

### Changing the Spinner Style

Modify the `spinner` variable:

```sh
local spinner='|/-\'           # current (ASCII-safe)
local spinner='+-x'            # alternative
local spinner='.oOo'           # alternative
```

Braille spinners (`⠋⠙⠹…`) are **not** safe on framebuffer consoles.

### Changing the Wizard Theme

Edit `setup_dialog_theme()` — the dialog color names are limited to the
16 ANSI colors; the rumahl blue (`BLUE`) approximates `#2563eb`.

## Performance

- ASCII splash: < 1 KB, ~2 seconds, negligible overhead
- Helper scripts: ~5 KB total
- Plymouth (when enabled): ~2-3 MB RAM

## Troubleshooting

### Boot Splash Not Showing

1. Check console: `ls -l /dev/console`
2. Test colors: `echo -e "\033[38;5;39mTest\033[0m"`
3. Check init: `grep show_boot_splash /init`

### Mojibake / Garbage Characters on the Console

The framebuffer console cannot render UTF-8 box-drawing/Braille glyphs
with the default VGA font. Any new splash/shell output must stay 7-bit
ASCII (see above). The dialog widgets are unaffected.

### Colors Not Displaying

Some basic VTs only support 16 colors; 256-color SGR escapes degrade
automatically. Colors are cosmetic — the installer works without them.

### Cannot Return to Installer

```sh
ls -l /bin/install       # must exist
export PATH=/bin:/sbin:/usr/bin:/usr/sbin:$PATH
/bin/install             # or: installer
```
