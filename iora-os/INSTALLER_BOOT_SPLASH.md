# IORA OS Installer Boot Splash and CLI Navigation

This document describes the boot splash screen and enhanced CLI navigation features added to the IORA OS installer.

## Boot Splash Screen

### Overview

When IORA OS installer boots, instead of a black screen, users now see:
- **IORA Logo** in ASCII art
- **Loading spinner** with animation
- **Colored status messages** indicating boot progress

### Visual Example

```
          ██╗ ██████╗ ██████╗  █████╗
          ██║██╔═══██╗██╔══██╗██╔══██╗
          ██║██║   ██║██████╔╝███████║
          ██║██║   ██║██╔══██╗██╔══██║
          ██║╚██████╔╝██║  ██║██║  ██║
          ╚═╝ ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝

       Interface for Optimized Residential Autonomy


          Starting IORA OS Installer...
          ⠋ Loading system components...
```

### Technical Details

**Implementation**: `init_extracted.sh` - `show_boot_splash()` function

**Features**:
- **ANSI Color Support**: Uses escape codes for cyan, blue, and white text
- **Cursor Management**: Hides cursor during animation, restores after
- **Animated Spinner**: Braille pattern spinner (⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏) with 10 frames
- **Duration**: ~2 seconds of animation while system initializes
- **Compatibility**: Falls back gracefully if colors not supported

**Color Codes**:
```sh
CYAN='\033[0;36m'   # Cyan for main messages
WHITE='\033[1;37m'  # Bold white for logo
BLUE='\033[0;34m'   # Blue for spinner
RESET='\033[0m'     # Reset to default
```

### Plymouth Integration

For full graphical boot splash (on systems with framebuffer support):

**Buildroot Packages Added**:
- `BR2_PACKAGE_PLYMOUTH` - Main Plymouth package
- `BR2_PACKAGE_PLYMOUTH_THEMES` - Theme support
- `BR2_PACKAGE_FBV` - Framebuffer image viewer
- `BR2_PACKAGE_FBSET` - Framebuffer configuration

**Future Enhancement**: Custom Plymouth theme with IORA branding can be added to `/board/iora/rootfs-overlay/usr/share/plymouth/themes/iora/`

## CLI Navigation and Helper Commands

### Enhanced Command Suite

The installer now provides a comprehensive set of helper commands accessible from the recovery shell.

### Available Commands

| Command | Description | Alias |
|---------|-------------|-------|
| `install` | Restart the IORA OS installation wizard | - |
| `installer` | Alias for `install` command | Yes |
| `help` | Show all available commands with descriptions | - |
| `sysinfo` | Display detailed system information | - |
| `netsetup` | Configure network interfaces via DHCP | - |
| `reboot` | Reboot the system | - |
| `poweroff` | Shut down the system | - |

### Returning to Installer from CLI

Users can return to the installation wizard from the shell at any time by typing:

```bash
install
```

or

```bash
installer
```

Both commands display a confirmation message and restart the wizard:

```
  ╔══════════════════════════════════════════════════╗
  ║  Restarting IORA OS Installation Wizard...      ║
  ╚══════════════════════════════════════════════════╝
```

### Command Examples

#### 1. System Information (`sysinfo`)

```bash
$ sysinfo

  ╔══════════════════════════════════════════════════╗
  ║         IORA OS System Information               ║
  ╚══════════════════════════════════════════════════╝

  CPU:     Intel(R) Core(TM) i7-9700K CPU @ 3.60GHz
  Cores:   8
  Memory:  16384 MB
  Boot:    UEFI

  === Block Devices ===
  NAME   MAJ:MIN RM   SIZE RO TYPE MOUNTPOINT
  sda      8:0    0 238.5G  0 disk
  ├─sda1   8:1    0   512M  0 part
  ├─sda2   8:2    0     2G  0 part
  ├─sda3   8:3    0     2G  0 part
  └─sda4   8:4    0   234G  0 part

  === Network ===
  eth0             UP             192.168.1.100/24
```

#### 2. Network Setup (`netsetup`)

```bash
$ netsetup

  ╔══════════════════════════════════════════════════╗
  ║         Network Configuration                    ║
  ╚══════════════════════════════════════════════════╝

  Bringing up network interfaces...
  ✓ eth0: DHCP configured
```

#### 3. Help Command (`help`)

```bash
$ help

  ╔══════════════════════════════════════════════════╗
  ║     IORA OS Installer - Available Commands      ║
  ╚══════════════════════════════════════════════════╝

  install     - Restart the IORA OS installation wizard
  installer   - Alias for 'install' command
  sysinfo     - Display system information
  netsetup    - Configure network via DHCP
  help        - Show this help message
  reboot      - Reboot the system
  poweroff    - Shut down the system

  To return to the installer at any time, type:
  install or installer
```

## Recovery Shell Experience

### Welcome Banner

When the installation wizard exits (user cancels or completes), a formatted banner appears:

```
  ╔══════════════════════════════════════════════════════════════╗
  ║                                                              ║
  ║          IORA OS Installation - Recovery Shell              ║
  ║                                                              ║
  ╚══════════════════════════════════════════════════════════════╝

  The installation wizard has exited.
  You are now in a recovery shell.

  Available commands:
    install     - Restart the installation wizard
    installer   - Restart the installation wizard (alias)
    sysinfo     - Show system information
    netsetup    - Configure network via DHCP
    help        - Show all available commands
    reboot      - Reboot the system
    poweroff    - Shut down

  Type 'install' or 'installer' to return to the installation wizard.
```

### Shell Availability

The system attempts to use the best available shell:

1. `/bin/bash` (Bash shell) - preferred
2. `/bin/sh` (POSIX shell) - fallback
3. `/bin/busybox sh` (BusyBox shell) - minimal fallback
4. `sh` (system default)

## Use Cases

### Scenario 1: User Needs System Information Before Installing

```bash
# Boot IORA OS installer
# See boot splash with logo and spinner
# Exit wizard to shell (press Cancel or Esc)

$ sysinfo
# Review hardware specs

$ netsetup
# Configure network if needed

$ install
# Return to installation wizard
```

### Scenario 2: Network Configuration During Install

```bash
# Start installation wizard
# Realize network isn't working
# Exit to shell

$ netsetup
# Configure DHCP

$ installer
# Return to wizard with network configured
```

### Scenario 3: Troubleshooting Install Issues

```bash
# Installation fails
# Automatically drops to recovery shell

$ sysinfo
# Check available disk space

$ lsblk
# Manually inspect block devices

$ help
# See what commands are available

$ install
# Try installation again
```

## Customization

### Changing Boot Splash Logo

Edit `init_extracted.sh`, function `show_boot_splash()`:

```bash
cat <<'SPLASH'
    # Your custom ASCII art here
SPLASH
```

### Changing Spinner Style

Modify the spinner variable in `show_boot_splash()`:

```bash
# Current (Braille dots)
local spinner='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'

# Alternative options:
local spinner='|/-\\'           # Classic
local spinner='◐◓◑◒'            # Circles
local spinner='▁▂▃▄▅▆▇█▇▆▅▄▃▂'  # Blocks
local spinner='⣾⣽⣻⢿⡿⣟⣯⣷'        # Dots
```

### Adding Custom Commands

Add new commands by creating executable scripts in `/bin/`:

```bash
cat > /bin/mycommand <<'SHEOF'
#!/bin/sh
echo "My custom command"
# Your logic here
SHEOF
chmod +x /bin/mycommand
```

Then add to the help display in the entry point section.

## Plymouth Theme Development (Future)

To create a full graphical boot splash:

1. **Create Theme Directory**:
   ```bash
   mkdir -p board/iora/rootfs-overlay/usr/share/plymouth/themes/iora
   ```

2. **Add Theme Files**:
   - `iora.plymouth` - Theme configuration
   - `iora.script` - Plymouth script (animations)
   - `logo.png` - IORA logo image
   - `background.png` - Background image

3. **Configure Default Theme**:
   ```bash
   plymouth-set-default-theme iora
   ```

4. **Rebuild Initramfs**:
   Plymouth themes are loaded from initramfs during early boot.

## Performance Considerations

### Boot Splash Timing

- **Splash Display**: ~2 seconds
- **System Initialization**: Parallel with splash
- **Total Overhead**: Negligible (~100ms for rendering)

### Memory Usage

- **ASCII Splash**: <1 KB
- **Helper Scripts**: ~5 KB total
- **Plymouth (if enabled)**: ~2-3 MB RAM

### Disabling Boot Splash

To disable the boot splash screen, comment out in `init_extracted.sh`:

```bash
# show_boot_splash  # Disabled
```

## Troubleshooting

### Boot Splash Not Showing

**Symptoms**: Black screen, no logo appears

**Possible Causes**:
1. Console not available yet
2. Terminal doesn't support ANSI colors
3. Script error before splash

**Solutions**:
```bash
# Check console
ls -l /dev/console

# Test ANSI colors
echo -e "\033[0;36mTest\033[0m"

# Check init script
cat /init | grep show_boot_splash
```

### Cannot Return to Installer

**Symptoms**: `install` command not found

**Possible Causes**:
1. `/bin/install` not created
2. PATH doesn't include `/bin`

**Solutions**:
```bash
# Check if command exists
ls -l /bin/install

# Add to PATH
export PATH=/bin:/sbin:/usr/bin:/usr/sbin:$PATH

# Run directly
/bin/install
```

### Colors Not Displaying

**Symptoms**: See escape codes instead of colors

**Cause**: Terminal doesn't support ANSI escape sequences

**Solution**: Colors are cosmetic and don't affect functionality. The installer will work fine without them.

## References

- [ANSI Escape Codes](https://en.wikipedia.org/wiki/ANSI_escape_code)
- [Plymouth Boot Splash](https://www.freedesktop.org/wiki/Software/Plymouth/)
- [BusyBox Shell](https://busybox.net/downloads/BusyBox.html#ash)
- [Linux Framebuffer](https://www.kernel.org/doc/Documentation/fb/framebuffer.txt)
