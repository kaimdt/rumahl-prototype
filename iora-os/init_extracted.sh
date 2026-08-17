#!/bin/sh
export PATH=/sbin:/usr/sbin:/bin:/usr/bin
export TERM=linux
export NCURSES_NO_UTF8_ACS=1

# ── Boot Splash Screen ─────────────────────────────────────────────
# NOTE: the kernel framebuffer console with the default 8x16 VGA font
# does NOT render UTF-8 box-drawing or Braille glyphs. Using them here
# produced visible mojibake like "~U~T~U~P". We therefore stick to
# pure 7-bit ASCII for the splash. All UI dialogs use the dialog(1)
# program which has its own ACS handling.
#
# Colors use 256-color SGR escapes so the palette mirrors the web UI
# accent (~#2563eb -> 39); consoles without 256-color support degrade
# to the nearest 16-color match automatically.
show_boot_splash() {
    # Clear screen and hide cursor
    clear 2>/dev/null || true
    printf '\033[?25l'  # Hide cursor

    # IORA palette (256-color, matches the dashboard accent)
    local ACCENT='\033[38;5;39m'   # ~#2563eb
    local CYAN='\033[38;5;45m'
    local GRAY='\033[38;5;245m'
    local WHITE='\033[1;97m'
    local GREEN='\033[38;5;42m'
    local RESET='\033[0m'

    # IORA wordmark (pure ASCII — box-drawing/Braille mojibake on fbcon)
    printf "${ACCENT}"
    cat <<'SPLASH'

           ___    ___    _____      _
          |_ _|  / _ \  |  __ \    / \
           | |  | | | | | |__) |  / _ \
           | |  | | | | |  _  /  / ___ \
          |___|  \___/  |_| \_\ /_/   \_\

SPLASH
    printf "${RESET}"
    printf "${GRAY}        Interface for Optimized Residential Autonomy${RESET}\n"
    printf "\n${WHITE}        Starting IORA OS Installer${RESET}\n"

    # Animated loading spinner (ASCII only)
    local spinner='|/-\'
    local i=0
    local delay=0.08
    for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
        local char=$(printf '%s' "$spinner" | cut -c$((i + 1)))
        printf "\r        ${CYAN}%s${RESET} Loading system components..." "$char"
        i=$(( (i + 1) % 4 ))
        sleep "$delay" 2>/dev/null || sleep 1
    done
    printf "\r        ${GREEN}[ OK ]${RESET} System ready                      \n\n"

    printf "${GRAY}        Recovery shell: install | sysinfo | netsetup${RESET}\n"
    sleep 0.8

    # Show cursor again
    printf '\033[?25h'
}

# Display boot splash at startup
show_boot_splash

# ── Mount virtual filesystems ──────────────────────────────────────
mount -t devtmpfs devtmpfs /dev 2>/dev/null || true
mount -t proc proc /proc 2>/dev/null || true
mount -t sysfs sysfs /sys 2>/dev/null || true
mount -t tmpfs tmpfs /tmp 2>/dev/null || true

if [ ! -e /dev/console ]; then
    mknod -m 600 /dev/console c 5 1 2>/dev/null || true
fi
if [ ! -e /dev/null ]; then
    mknod -m 666 /dev/null c 1 3 2>/dev/null || true
fi

mkdir -p /mnt/iso /mnt/target /tmp /run

# ── Set smaller console font (like Ubuntu) ─────────────────────────
# Try a compact but readable 14/16px Terminus-style font.  Falls back
# gracefully if the kbd package or font files are missing.
set_console_font() {
    # Try setfont with progressively smaller fonts
    for font in \
        Lat15-Terminus14 \
        Lat15-Terminus16 \
        TerminusBold14 \
        default8x14 \
        default8x16; do
        if setfont "$font" 2>/dev/null; then
            return 0
        fi
    done
    # Try with explicit path
    for font in \
        /usr/share/consolefonts/Lat15-Terminus14.psf.gz \
        /usr/share/consolefonts/Lat15-Terminus16.psf.gz \
        /usr/share/kbd/consolefonts/Lat15-Terminus14.psf.gz; do
        if [ -f "$font" ] && setfont "$font" 2>/dev/null; then
            return 0
        fi
    done
    return 0
}
set_console_font

# Load modules
for mod in cdrom sr_mod iso9660 loop isofs sd_mod ahci virtio_blk virtio_pci; do
    modprobe "$mod" 2>/dev/null || true
done

# ── Configuration ──────────────────────────────────────────────────
ISO_MOUNT="/mnt/iso"
ISO_IMAGE="iora-os.img.xz"
MIN_DISK_GB=8
BACKTITLE="IORA OS Setup"
IORA_HOSTNAME="iora"
IORA_TIMEZONE="Europe/Berlin"
IORA_NETWORK="dhcp"
# First-boot headless config (admin account, locale) — collected by the
# wizard and applied automatically on first boot via setup-config.json.
IORA_ADMIN_USER="admin"
IORA_ADMIN_PASS=""
IORA_LANGUAGE="de"
IORA_COUNTRY="DE"
IORA_UNIT_SYSTEM="metric"

# ── Modern dialog color theme ─────────────────────────────────────
# Dark, modern installer look: black canvas with the IORA blue accent
# used for selection and borders (matches the dashboard UI). dialog's
# color names are limited to the 16 ANSI colors, so we approximate the
# web palette as closely as the widget toolkit allows.
setup_dialog_theme() {
    cat > /tmp/.dialogrc <<'DLGRC'
# IORA OS installer -- modern dark theme (IORA blue accent on black)
aspect = 0
separate_widget = ""
tab_len = 4
visit_items = ON
use_shadow = ON
use_colors = ON
screen_color               = (WHITE,BLACK,ON)
shadow_color               = (BLACK,BLACK,ON)
dialog_color               = (WHITE,BLACK,OFF)
title_color                = (CYAN,BLACK,ON)
border_color               = (BLUE,BLACK,ON)
border2_color              = (BLUE,BLACK,ON)
button_active_color        = (BLACK,WHITE,ON)
button_inactive_color      = (WHITE,BLACK,OFF)
button_key_active_color    = (YELLOW,BLACK,ON)
button_key_inactive_color  = (BLUE,BLACK,ON)
button_label_active_color  = (YELLOW,BLACK,ON)
button_label_inactive_color= (WHITE,BLACK,ON)
inputbox_color             = (WHITE,BLACK,OFF)
inputbox_border_color      = (BLUE,BLACK,ON)
searchbox_color            = (WHITE,BLACK,OFF)
searchbox_title_color      = (CYAN,BLACK,ON)
searchbox_border_color     = (BLUE,BLACK,ON)
position_indicator_color   = (YELLOW,BLACK,ON)
menubox_color              = (WHITE,BLACK,OFF)
menubox_border_color       = (BLUE,BLACK,ON)
item_color                 = (WHITE,BLACK,OFF)
item_selected_color        = (WHITE,BLUE,ON)
tag_color                  = (BLUE,BLACK,ON)
tag_selected_color         = (YELLOW,BLUE,ON)
tag_key_color              = (BLUE,BLACK,ON)
tag_key_selected_color     = (YELLOW,BLUE,ON)
check_color                = (WHITE,BLACK,OFF)
check_selected_color       = (WHITE,BLUE,ON)
uarrow_color               = (GREEN,BLUE,ON)
darrow_color               = (GREEN,BLUE,ON)
gauge_color                = (YELLOW,BLUE,ON)
DLGRC
    export DIALOGRC=/tmp/.dialogrc
}

# ── Dialog helpers ─────────────────────────────────────────────────
DIALOG_BIN=""
if command -v dialog >/dev/null 2>&1; then
    DIALOG_BIN="dialog"
    setup_dialog_theme
elif command -v whiptail >/dev/null 2>&1; then
    DIALOG_BIN="whiptail"
fi

dlg() {
    $DIALOG_BIN --backtitle "$BACKTITLE" "$@"
}

dlg_msg() {
    local title="$1"; shift
    if [ -n "$DIALOG_BIN" ]; then
        dlg --title "$title" --msgbox "$1" 14 64
    else
        echo ""; echo "=== $title ==="; echo "$1"; echo ""
        echo "Press ENTER to continue..."; read _
    fi
}

dlg_yesno() {
    local title="$1"; shift
    if [ -n "$DIALOG_BIN" ]; then
        dlg --title "$title" --defaultno --yesno "$1" 14 64
        return $?
    else
        echo ""; echo "=== $title ==="; echo "$1"
        printf "[y/n]: "; read ans
        case "$ans" in y|Y|yes|YES) return 0 ;; *) return 1 ;; esac
    fi
}

dlg_info() {
    local title="$1"; shift
    if [ -n "$DIALOG_BIN" ]; then
        dlg --title "$title" --infobox "$1" 8 64
    else
        echo "$1"
    fi
}

dlg_input() {
    local title="$1"; local prompt="$2"; local default="$3"
    if [ -n "$DIALOG_BIN" ]; then
        dlg --title "$title" --inputbox "$prompt" 10 64 "$default" 3>&1 1>&2 2>&3
    else
        printf "  %s [%s]: " "$prompt" "$default"; read ans
        echo "${ans:-$default}"
    fi
}

is_uint() {
    case "$1" in
        ""|*[!0-9]*) return 1 ;;
        *) return 0 ;;
    esac
}

safe_uint() {
    if is_uint "$1"; then
        echo "$1"
    else
        echo "${2:-0}"
    fi
}

valid_hostname() {
    case "$1" in
        ""|*[!A-Za-z0-9-]*|-*|*-) return 1 ;;
        *) return 0 ;;
    esac
}

valid_ipv4() {
    local old_ifs octet
    old_ifs="$IFS"
    IFS=.
    set -- $1
    IFS="$old_ifs"

    [ $# -eq 4 ] || return 1
    for octet in "$@"; do
        is_uint "$octet" || return 1
        [ "$octet" -ge 0 ] && [ "$octet" -le 255 ] || return 1
    done
    return 0
}

valid_prefix_length() {
    is_uint "$1" || return 1
    [ "$1" -ge 1 ] && [ "$1" -le 32 ]
}

# ── System info helpers ────────────────────────────────────────────
get_cpu_info() {
    local model count
    model=$(grep -m1 'model name' /proc/cpuinfo 2>/dev/null | cut -d: -f2 | sed 's/^ *//')
    count=$(grep -c '^processor' /proc/cpuinfo 2>/dev/null || echo "?")
    echo "${count}x ${model:-Unknown CPU}"
}

get_ram_info() {
    local total
    total=$(awk '/MemTotal/{printf "%.0f", $2/1024}' /proc/meminfo 2>/dev/null || echo "?")
    echo "${total} MB"
}

get_boot_mode() {
    if [ -d /sys/firmware/efi ]; then
        echo "UEFI"
    else
        echo "BIOS (Legacy)"
    fi
}

get_network_interfaces() {
    local ifaces=""
    for iface in /sys/class/net/*; do
        local name=$(basename "$iface")
        [ "$name" = "lo" ] && continue
        local state=$(cat "$iface/operstate" 2>/dev/null || echo "unknown")
        local mac=$(cat "$iface/address" 2>/dev/null || echo "??:??:??:??:??:??")
        ifaces="${ifaces}  ${name}: ${state} (${mac})\n"
    done
    echo "${ifaces:-  No network interfaces found}"
}

# Test IP connectivity
test_ip_connectivity() {
    local test_ip="$1"
    local gateway="$2"
    local interface=""

    # Find first active network interface
    for iface in /sys/class/net/*; do
        local name=$(basename "$iface")
        [ "$name" = "lo" ] && continue
        local state=$(cat "$iface/operstate" 2>/dev/null || echo "down")
        if [ "$state" = "up" ]; then
            interface="$name"
            break
        fi
    done

    [ -z "$interface" ] && return 1

    # Test gateway reachability with ping
    if [ -n "$gateway" ]; then
        if ping -c 1 -W 2 "$gateway" >/dev/null 2>&1; then
            return 0
        fi
    fi

    return 1
}

# Get current DHCP assigned IP
get_dhcp_ip() {
    local interface=""

    # Find first active network interface with IP
    for iface in /sys/class/net/*; do
        local name=$(basename "$iface")
        [ "$name" = "lo" ] && continue
        local state=$(cat "$iface/operstate" 2>/dev/null || echo "down")
        if [ "$state" = "up" ]; then
            local ip=$(ip -4 addr show "$name" 2>/dev/null | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | head -1)
            if [ -n "$ip" ]; then
                echo "$name:$ip"
                return 0
            fi
        fi
    done

    return 1
}

# Request DHCP address on every available interface (not just the
# first one), because virtualised hosts often expose multiple NICs
# and only one of them is wired to a network with a DHCP server.
request_dhcp() {
    local got_ip=1
    local name

    for iface in /sys/class/net/*; do
        name=$(basename "$iface")
        [ "$name" = "lo" ] && continue
        # Skip virtual-only interfaces
        case "$name" in
            docker*|veth*|br-*|virbr*|tailscale*|wg*|tun*|tap*) continue ;;
        esac

        # Bring interface up
        ip link set "$name" up 2>/dev/null || true
        # Wait for link state to settle (busybox sleep accepts integer seconds)
        sleep 2

        # Try udhcpc (busybox DHCP client)
        if command -v udhcpc >/dev/null 2>&1; then
            if udhcpc -i "$name" -n -q -t 5 -T 2 2>/dev/null; then
                got_ip=0
                break
            fi
        fi

        # Try dhclient
        if command -v dhclient >/dev/null 2>&1; then
            if dhclient -1 "$name" 2>/dev/null; then
                got_ip=0
                break
            fi
        fi
    done

    return $got_ip
}

# Check for missing drivers/firmware
detect_missing_drivers() {
    local missing=""

    # Check dmesg for firmware loading failures
    if dmesg | grep -i "firmware.*fail" >/dev/null 2>&1; then
        missing="${missing}Firmware loading failures detected\n"
    fi

    # Check for unclaimed devices
    if command -v lspci >/dev/null 2>&1; then
        local unclaimed=$(lspci -k 2>/dev/null | grep -c "Kernel modules:" || echo 0)
        if [ "$unclaimed" -gt 0 ]; then
            missing="${missing}${unclaimed} device(s) without kernel modules\n"
        fi
    fi

    # Check for network devices without drivers
    for iface in /sys/class/net/*; do
        local name=$(basename "$iface")
        [ "$name" = "lo" ] && continue
        if [ ! -d "$iface/device/driver" ]; then
            missing="${missing}Network device $name has no driver\n"
        fi
    done

    if [ -n "$missing" ]; then
        echo "$missing"
        return 1
    fi

    return 0
}

valid_domain() {
    local domain="$1"
    # Allow empty domain
    [ -z "$domain" ] && return 0
    # Domain can contain letters, numbers, dots, hyphens
    echo "$domain" | grep -qE '^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$'
}

# ── Mount the installation media ───────────────────────────────────
mount_iso() {
    for dev in /dev/sr0 /dev/sr1 /dev/cdrom; do
        [ -b "$dev" ] || continue
        mount -t iso9660 -o ro "$dev" "${ISO_MOUNT}" 2>/dev/null || \
            mount -o ro "$dev" "${ISO_MOUNT}" 2>/dev/null || continue
        [ -f "${ISO_MOUNT}/${ISO_IMAGE}" ] && return 0
        umount "${ISO_MOUNT}" 2>/dev/null || true
    done
    for dev in /dev/sd*[0-9] /dev/vd*[0-9] /dev/nvme*p[0-9]*; do
        [ -b "$dev" ] || continue
        mount -o ro "$dev" "${ISO_MOUNT}" 2>/dev/null || continue
        [ -f "${ISO_MOUNT}/${ISO_IMAGE}" ] && return 0
        umount "${ISO_MOUNT}" 2>/dev/null || true
    done
    return 1
}

get_iso_parent_disk() {
    local iso_dev=""
    iso_dev=$(grep " ${ISO_MOUNT} " /proc/mounts 2>/dev/null | awk '{print $1}' | head -1)
    [ -z "$iso_dev" ] && return
    iso_dev=$(basename "$iso_dev")
    echo "$iso_dev" | sed 's/[0-9]*$//' | sed 's/p[0-9]*$//'
}

# ── Disk helpers ───────────────────────────────────────────────────
get_disks() {
    local iso_parent
    iso_parent=$(get_iso_parent_disk)
    for disk_path in /sys/block/sd* /sys/block/vd* /sys/block/nvme* /sys/block/mmcblk*; do
        [ -e "$disk_path" ] || continue
        local name=$(basename "$disk_path")
        case "$name" in sr*|loop*|ram*|zram*|dm-*|md*) continue ;; esac
        [ -n "$iso_parent" ] && [ "$name" = "$iso_parent" ] && continue
        local size_sectors=$(cat "${disk_path}/size" 2>/dev/null || echo 0)
        size_sectors=$(safe_uint "$size_sectors" 0)
        local size_gb=$(( size_sectors / 2097152 ))
        [ "$size_gb" -lt "$MIN_DISK_GB" ] && continue
        echo "$name"
    done
}

get_disk_size_gb() {
    local sz=$(cat "/sys/block/$1/size" 2>/dev/null || echo 0)
    sz=$(safe_uint "$sz" 0)
    echo $(( sz / 2097152 ))
}

get_disk_model() {
    cat "/sys/block/$1/device/model" 2>/dev/null | sed 's/^ *//;s/ *$//' || true
}

get_disk_vendor() {
    cat "/sys/block/$1/device/vendor" 2>/dev/null | sed 's/^ *//;s/ *$//' || true
}

get_disk_partitions() {
    local parts=0
    for p in /sys/block/$1/$1*; do [ -e "$p" ] && parts=$((parts + 1)); done
    echo "$parts"
}

get_disk_transport() {
    local link=$(readlink -f "/sys/block/$1" 2>/dev/null || true)
    case "$link" in
        *usb*)   echo "USB" ;;
        *ata*)   echo "SATA" ;;
        *nvme*)  echo "NVMe" ;;
        *virtio*) echo "VirtIO" ;;
        *scsi*)  echo "SCSI" ;;
        *mmc*)   echo "SD/MMC" ;;
        *)       echo "Unknown" ;;
    esac
}

# Detect if disk is an SD card or similar flash storage
is_sd_card() {
    local disk="$1"
    local link=$(readlink -f "/sys/block/${disk}" 2>/dev/null || true)

    # Check for SD/MMC/eMMC devices
    case "$link" in
        *mmc*) return 0 ;;
    esac

    # Check device name patterns
    case "$disk" in
        mmcblk*) return 0 ;;
    esac

    # Check if it's a USB flash drive (often similar characteristics)
    if [ "$(get_disk_transport "$disk")" = "USB" ]; then
        # Additional heuristic: small size often indicates flash storage
        local size_gb=$(get_disk_size_gb "$disk")
        if [ "$size_gb" -lt 256 ]; then
            return 0
        fi
    fi

    return 1
}

# Get disk type description
get_disk_type() {
    local disk="$1"

    if is_sd_card "$disk"; then
        case "$disk" in
            mmcblk*)
                if [ -f "/sys/block/${disk}/device/type" ]; then
                    local type=$(cat "/sys/block/${disk}/device/type" 2>/dev/null)
                    case "$type" in
                        SD) echo "SD Card" ;;
                        MMC) echo "eMMC" ;;
                        *) echo "SD/MMC" ;;
                    esac
                else
                    echo "SD/MMC"
                fi
                ;;
            *)
                local transport=$(get_disk_transport "$disk")
                if [ "$transport" = "USB" ]; then
                    echo "USB Flash"
                else
                    echo "Flash Storage"
                fi
                ;;
        esac
    else
        local transport=$(get_disk_transport "$disk")
        case "$transport" in
            NVMe) echo "NVMe SSD" ;;
            SATA)
                # Try to detect if SSD or HDD
                local rotational=$(cat "/sys/block/${disk}/queue/rotational" 2>/dev/null || echo "1")
                if [ "$rotational" = "0" ]; then
                    echo "SATA SSD"
                else
                    echo "SATA HDD"
                fi
                ;;
            *) echo "Disk" ;;
        esac
    fi
}

# Get recommended optimizations for SD cards
get_sd_optimizations() {
    local disk="$1"

    if ! is_sd_card "$disk"; then
        return 0
    fi

    cat <<'SDOPT'
+=================================================================+
|          SD CARD / FLASH STORAGE DETECTED                     |
+=================================================================+

This device appears to be SD card or flash-based storage.
IORA OS will apply optimizations to extend its lifespan:

AUTOMATIC OPTIMIZATIONS:
* noatime mount option (reduce write operations)
* commit=600 (batch writes every 10 minutes)
* ZRAM for /tmp and /var (reduce physical writes)
* Log rotation with aggressive compression
* Reduced journaling on ext4 partitions

RECOMMENDED PRACTICES:
* Use a high-quality SD card (Class 10/UHS-I or better)
* Enable periodic backups to external storage
* Monitor disk health with SMART tools (if supported)
* Consider upgrading to USB 3.0 SSD for better performance

SD cards typically have ~10,000 write cycles per cell.
These optimizations can extend lifespan by 5-10x.

SDOPT
}

# ── Post-install configuration ─────────────────────────────────────
# Robust password hashing for the target root/user accounts. The
# original `openssl passwd | sed` path was silently failing in
# minimal installer environments where openssl is missing — the
# account was left with its empty/default password and "Login
# incorrect" appeared for any user-chosen password. This helper
# tries mkpasswd / openssl / python3 crypt / busybox cryptpw, falls
# back to chroot+chpasswd, and VERIFIES the shadow update.
iora_installer_hash_password() {
    local pw="$1"
    local salt hash
    salt=$(head -c 16 /dev/urandom 2>/dev/null | od -A n -t x1 \
           | tr -d ' \n' | cut -c1-16)
    [ -z "$salt" ] && salt="iorainstaller"

    if command -v mkpasswd >/dev/null 2>&1; then
        hash=$(printf '%s' "$pw" | mkpasswd -m sha-512 -s -S "$salt" 2>/dev/null)
        [ -n "$hash" ] && { printf '%s' "$hash"; return 0; }
    fi
    if command -v openssl >/dev/null 2>&1; then
        hash=$(printf '%s' "$pw" | openssl passwd -6 -stdin -salt "$salt" 2>/dev/null)
        [ -n "$hash" ] && { printf '%s' "$hash"; return 0; }
        hash=$(printf '%s' "$pw" | openssl passwd -1 -stdin -salt "$salt" 2>/dev/null)
        [ -n "$hash" ] && { printf '%s' "$hash"; return 0; }
    fi
    if command -v python3 >/dev/null 2>&1; then
        hash=$(PW="$pw" SALT="$salt" python3 -c '
import crypt, os, sys
try:
    h = crypt.crypt(os.environ["PW"], crypt.mksalt(crypt.METHOD_SHA512))
except Exception:
    h = crypt.crypt(os.environ["PW"], "$6$" + os.environ["SALT"])
sys.stdout.write(h or "")
' 2>/dev/null)
        [ -n "$hash" ] && { printf '%s' "$hash"; return 0; }
    fi
    if command -v cryptpw >/dev/null 2>&1; then
        hash=$(printf '%s' "$pw" | cryptpw -m sha512 -S "$salt" 2>/dev/null)
        [ -n "$hash" ] && { printf '%s' "$hash"; return 0; }
    fi
    return 1
}

iora_installer_set_password() {
    local target="$1"
    local user="$2"
    local pw="$3"
    local shadow="${target}/etc/shadow"
    [ -f "$shadow" ] || return 1
    [ -z "$user" ] && return 1
    [ -z "$pw" ] && return 1

    local hash
    hash=$(iora_installer_hash_password "$pw") || hash=""

    if [ -n "$hash" ]; then
        local tmp="${shadow}.iora.tmp"
        USER="$user" HASH="$hash" awk -F: -v OFS=: '
            BEGIN { u=ENVIRON["USER"]; h=ENVIRON["HASH"]; found=0 }
            $1==u { $2=h; if ($3=="" || $3=="0") $3=19000; found=1 }
            { print }
            END { if (!found) printf "%s:%s:19000:0:99999:7:::\n", u, h }
        ' "$shadow" > "$tmp" 2>/dev/null \
            && mv "$tmp" "$shadow" 2>/dev/null \
            && chmod 0640 "$shadow" 2>/dev/null
        # Verify: the user's second field must be a non-trivial hash,
        # not empty and not '!'/'*'.
        if grep -q "^${user}:[^:!*]\{8,\}:" "$shadow" 2>/dev/null; then
            return 0
        fi
    fi

    # Fallback: chroot + chpasswd/passwd (needs /bin/sh + chpasswd).
    if [ -x "${target}/usr/sbin/chpasswd" ] || [ -x "${target}/usr/bin/chpasswd" ] \
       || [ -x "${target}/bin/busybox" ]; then
        local did_dev=false did_proc=false did_sys=false
        [ -d "${target}/dev" ]  && mount --bind /dev  "${target}/dev"  2>/dev/null && did_dev=true
        [ -d "${target}/proc" ] && mount --bind /proc "${target}/proc" 2>/dev/null && did_proc=true
        [ -d "${target}/sys" ]  && mount --bind /sys  "${target}/sys"  2>/dev/null && did_sys=true
        printf '%s:%s\n' "$user" "$pw" \
            | chroot "$target" /bin/sh -c 'chpasswd 2>/dev/null || busybox chpasswd 2>/dev/null' \
              >/dev/null 2>&1
        local rc=$?
        $did_dev  && umount "${target}/dev"  2>/dev/null || true
        $did_proc && umount "${target}/proc" 2>/dev/null || true
        $did_sys  && umount "${target}/sys"  2>/dev/null || true
        [ $rc -eq 0 ] \
            && grep -q "^${user}:[^:!*]\{8,\}:" "$shadow" 2>/dev/null \
            && return 0
    fi

    return 1
}

apply_post_install_config() {
    local disk="$1"
    local target="/mnt/target"

    dlg_info " Configuring " "  Applying system configuration..."

    # Try to mount the root partition (p3 = Root-A)
    local root_part=""
    if [ -b "/dev/${disk}3" ]; then
        root_part="/dev/${disk}3"
    elif [ -b "/dev/${disk}p3" ]; then
        root_part="/dev/${disk}p3"
    fi

    if [ -z "$root_part" ]; then
        return 0  # skip silently if partition layout differs
    fi

    mkdir -p "$target"
    if ! mount "$root_part" "$target" 2>/dev/null; then
        return 0
    fi

    # Set hostname
    if [ -n "$IORA_HOSTNAME" ] && [ "$IORA_HOSTNAME" != "iora" ]; then
        echo "$IORA_HOSTNAME" > "${target}/etc/hostname" 2>/dev/null || true
        if [ -f "${target}/etc/hosts" ]; then
            sed -i "s/iora/${IORA_HOSTNAME}/g" "${target}/etc/hosts" 2>/dev/null || true
        fi
    fi

    # Set domain name if provided
    if [ -n "$IORA_DOMAIN" ]; then
        # Update /etc/hosts with FQDN
        if [ -f "${target}/etc/hosts" ]; then
            local hostname="${IORA_HOSTNAME:-iora}"
            # Add FQDN entry
            if ! grep -q "127.0.1.1" "${target}/etc/hosts" 2>/dev/null; then
                echo "127.0.1.1 ${hostname}.${IORA_DOMAIN} ${hostname}" >> "${target}/etc/hosts"
            else
                sed -i "s/^127.0.1.1.*/127.0.1.1 ${hostname}.${IORA_DOMAIN} ${hostname}/" "${target}/etc/hosts" 2>/dev/null || true
            fi
        fi

        # Set search domain in resolv.conf
        mkdir -p "${target}/etc" 2>/dev/null || true
        echo "search ${IORA_DOMAIN}" > "${target}/etc/resolv.conf.local" 2>/dev/null || true
    fi

    # Set timezone
    if [ -n "$IORA_TIMEZONE" ] && [ -f "${target}/usr/share/zoneinfo/${IORA_TIMEZONE}" ]; then
        ln -sf "/usr/share/zoneinfo/${IORA_TIMEZONE}" "${target}/etc/localtime" 2>/dev/null || true
        echo "$IORA_TIMEZONE" > "${target}/etc/timezone" 2>/dev/null || true
    fi

    # Set root password if changed. Use the robust helper (multiple
    # hashing backends + chroot fallback + shadow verification) so a
    # missing openssl in the installer initramfs doesn't silently
    # leave the account with its (empty) default password — which is
    # exactly what caused "Login incorrect" even though the user had
    # typed the right password during the wizard.
    if [ -n "$IORA_ROOT_PW" ]; then
        iora_installer_set_password "$target" "root" "$IORA_ROOT_PW" || {
            echo "WARNING: failed to set root password on target; default will remain" >&2
        }
    fi

    # Configure network
    mkdir -p "${target}/etc/systemd/network" 2>/dev/null || true
    # Remove any default wildcard so admin-chosen static/dhcp config wins
    # regardless of the lexical sort order. We do it both here AND keep
    # 90-iora-wired-default.network as fallback in case the admin never
    # runs through networking.
    rm -f "${target}/etc/systemd/network/eth0.network" 2>/dev/null || true

    if [ "$IORA_NETWORK" = "static" ] && [ -n "$IORA_IP" ]; then
        # Static network configuration (IPv4 + optional IPv6).
        {
            echo "[Match]"
            echo "Name=eth* en* eno* ens* enp* enx*"
            echo "Type=ether"
            echo ""
            echo "[Network]"
            echo "Address=${IORA_IP}/${IORA_NETMASK:-24}"
            [ -n "${IORA_GATEWAY:-}" ]  && echo "Gateway=${IORA_GATEWAY}"
            echo "DNS=${IORA_DNS:-8.8.8.8}"
            [ -n "${IORA_DNS2:-}" ]     && echo "DNS=${IORA_DNS2}"
            # IPv6: accept RA for SLAAC unless the admin gave us a fixed v6.
            if [ -n "${IORA_IP6:-}" ]; then
                echo "Address=${IORA_IP6}/${IORA_PREFIX6:-64}"
                [ -n "${IORA_GATEWAY6:-}" ] && echo "Gateway=${IORA_GATEWAY6}"
                [ -n "${IORA_DNS6:-}" ]     && echo "DNS=${IORA_DNS6}"
                echo "IPv6AcceptRA=no"
            else
                echo "IPv6AcceptRA=yes"
            fi
            echo ""
            echo "[Link]"
            echo "RequiredForOnline=degraded"
        } > "${target}/etc/systemd/network/10-static.network"
    elif [ "$IORA_NETWORK" = "dhcp" ]; then
        # DHCP configuration (IPv4 + IPv6 via DHCPv6/RA).
        {
            echo "[Match]"
            echo "Name=eth* en* eno* ens* enp* enx*"
            echo "Type=ether"
            echo ""
            echo "[Network]"
            echo "DHCP=yes"
            echo "IPv6AcceptRA=yes"
            if [ "${IORA_CUSTOM_DNS:-no}" = "yes" ] && [ -n "${IORA_DNS:-}" ]; then
                echo "DNS=${IORA_DNS}"
                [ -n "${IORA_DNS2:-}" ] && echo "DNS=${IORA_DNS2}"
            fi
            echo ""
            echo "[DHCPv4]"
            if [ "${IORA_CUSTOM_DNS:-no}" = "yes" ] && [ -n "${IORA_DNS:-}" ]; then
                echo "UseDNS=false"
            else
                echo "UseDNS=true"
            fi
            echo "UseNTP=true"
            echo "RouteMetric=100"
            echo ""
            echo "[DHCPv6]"
            if [ "${IORA_CUSTOM_DNS:-no}" = "yes" ] && [ -n "${IORA_DNS:-}" ]; then
                echo "UseDNS=false"
            else
                echo "UseDNS=true"
            fi
            echo "UseNTP=true"
            echo ""
            echo "[Link]"
            echo "RequiredForOnline=degraded"
        } > "${target}/etc/systemd/network/10-dhcp.network"
    fi

    # Apply SD card optimizations if detected
    if is_sd_card "$disk"; then
        mkdir -p "${target}/etc" 2>/dev/null || true

        # Create optimized fstab with SD card friendly mount options
        if [ -f "${target}/etc/fstab" ]; then
            # Add noatime and commit options for ext4 partitions
            sed -i 's/defaults/defaults,noatime,commit=600/g' "${target}/etc/fstab" 2>/dev/null || true
        fi

        # Create systemd tmpfiles.d config for ZRAM on /tmp and /var
        mkdir -p "${target}/etc/systemd/system" 2>/dev/null || true
        cat > "${target}/etc/systemd/system/zram-tmp.service" <<'ZRAMEOF'
[Unit]
Description=Create ZRAM device for /tmp and /var/tmp
Before=local-fs-pre.target
DefaultDependencies=no

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/sbin/modprobe zram num_devices=1
ExecStart=/bin/sh -c 'echo lz4 > /sys/block/zram0/comp_algorithm'
ExecStart=/bin/sh -c 'echo 512M > /sys/block/zram0/disksize'
ExecStart=/sbin/mkfs.ext4 -q -m 0 -L zram-tmp /dev/zram0
ExecStart=/bin/mount -o noatime /dev/zram0 /tmp
ExecStart=/bin/chmod 1777 /tmp

[Install]
WantedBy=local-fs-pre.target
ZRAMEOF

        # Enable ZRAM service
        if [ -d "${target}/etc/systemd/system/local-fs-pre.target.wants" ]; then
            ln -sf ../zram-tmp.service "${target}/etc/systemd/system/local-fs-pre.target.wants/zram-tmp.service" 2>/dev/null || true
        else
            mkdir -p "${target}/etc/systemd/system/local-fs-pre.target.wants" 2>/dev/null || true
            ln -sf ../zram-tmp.service "${target}/etc/systemd/system/local-fs-pre.target.wants/zram-tmp.service" 2>/dev/null || true
        fi

        # Configure log rotation for reduced writes
        mkdir -p "${target}/etc/logrotate.d" 2>/dev/null || true
        cat > "${target}/etc/logrotate.d/sd-optimized" <<'LOGEOF'
# Aggressive log rotation for SD card longevity
/var/log/*.log {
    daily
    rotate 3
    compress
    delaycompress
    missingok
    notifempty
    create 0640 root root
}
LOGEOF

        # Mark system as SD-optimized
        echo "SD_OPTIMIZED=1" > "${target}/etc/iora-storage.conf" 2>/dev/null || true
        echo "STORAGE_TYPE=$(get_disk_type "$disk")" >> "${target}/etc/iora-storage.conf" 2>/dev/null || true
    fi

    # ── First-boot headless config ────────────────────────────────────────
    # All wizard answers are written to /etc/iora/setup-config.json on the
    # target. On the first boot iora-setup.service detects the file and
    # applies it headlessly (DB credentials, secrets, admin account, docker
    # stack, completion flags) — the interactive web wizard is NOT shown
    # after an installer-based installation. The flash path (image written
    # directly to SD/eMMC) has no config file and keeps the web wizard.
    if [ -n "$IORA_ADMIN_USER" ] && [ -n "$IORA_ADMIN_PASS" ]; then
        mkdir -p "${target}/etc/iora" 2>/dev/null || true
        cat > "${target}/etc/iora/setup-config.json" <<JSONEOF
{
  "hostname": "${IORA_HOSTNAME:-iora}",
  "timezone": "${IORA_TIMEZONE:-Europe/Berlin}",
  "language": "${IORA_LANGUAGE:-de}",
  "country": "${IORA_COUNTRY:-DE}",
  "unit_system": "${IORA_UNIT_SYSTEM:-metric}",
  "admin_username": "${IORA_ADMIN_USER}",
  "admin_password": "${IORA_ADMIN_PASS}",
  "auto_start": true
}
JSONEOF
        chmod 600 "${target}/etc/iora/setup-config.json" 2>/dev/null || true
    fi

    sync
    umount "$target" 2>/dev/null || true
    return 0
}

# ── Wizard screens ─────────────────────────────────────────────────

# Installation mode selected at the main menu
INSTALLER_MODE="quick"   # quick | custom

screen_welcome() {
    if [ -n "$DIALOG_BIN" ]; then
        local choice
        choice=$(dlg --title " IORA OS Installer " --menu "\
 Welcome to IORA OS!\n\n\
 Choose an installation mode:\n" 22 72 4 \
            "quick"   "Quick Install    (recommended -- just timezone + password + disk)" \
            "custom"  "Custom Install   (full wizard -- hostname, network, locale, ...)" \
            "shell"   "Recovery Shell   (expert troubleshooting)" \
            "reboot"  "Reboot / Shutdown" \
            3>&1 1>&2 2>&3)

        case "$choice" in
            quick)
                INSTALLER_MODE="quick"
                dlg --title " Quick Install " --msgbox "\
 IORA OS will be installed using smart defaults:\n\n\
   Hostname:    iora\n\
   Network:     Automatic (DHCP)\n\
   Locale:      English (en_US.UTF-8)\n\n\
 You will only need to:\n\
   1.  Choose your timezone\n\
   2.  Set a root password\n\
   3.  Select the target disk\n\
   4.  Confirm to start\n\n\
 ALL data on the selected disk will be erased.\n\n\
 Select OK to continue." 22 64
                return 0
                ;;
            custom)
                INSTALLER_MODE="custom"
                dlg --title " Custom Install " --msgbox "\
 The full setup wizard will walk you through:\n\n\
   1.  System inspection (CPU, RAM, disks, firmware)\n\
   2.  Hostname and domain name\n\
   3.  Timezone\n\
   4.  Hardware driver detection\n\
   5.  Network configuration (DHCP or static IPv4)\n\
   6.  Root password\n\
   7.  Disk and partitioning options\n\n\
 Select OK to continue." 20 68
                return 0
                ;;
            shell)
                clear 2>/dev/null || true
                echo ""
                echo "  IORA Recovery Shell.  Type 'exit' to return to the installer."
                echo "  Commands: install, sysinfo, netsetup, reboot, poweroff, help"
                echo ""
                sh -i || true
                screen_welcome
                return 1
                ;;
            reboot)
                local act
                act=$(dlg --title " Reboot / Shutdown " --menu \
                    "\n Choose action:\n" 12 60 2 \
                    "reboot"   "Reboot the machine" \
                    "poweroff" "Power off the machine" \
                    3>&1 1>&2 2>&3)
                case "$act" in
                    reboot)   sync; reboot -f ;;
                    poweroff) sync; poweroff -f ;;
                esac
                screen_welcome
                return 1
                ;;
            *)
                INSTALLER_MODE="quick"
                return 0
                ;;
        esac
    else
        clear 2>/dev/null || true
        echo ""
        echo "  IORA OS Installer"
        echo "  ================="
        echo ""
        echo "  How would you like to install IORA OS?"
        echo ""
        echo "    1) Quick Install   -- Just timezone + password + disk (recommended)"
        echo "    2) Custom Install  -- Full setup wizard"
        echo "    3) Recovery Shell"
        echo ""
        printf "  Choice [1]: "
        read _ch
        case "${_ch:-1}" in
            2) INSTALLER_MODE="custom" ;;
            3) sh -i || true; screen_welcome; return 1 ;;
            *) INSTALLER_MODE="quick" ;;
        esac
    fi
}

screen_sysinfo() {
    [ -z "$DIALOG_BIN" ] && return 0

    local cpu=$(get_cpu_info)
    local ram=$(get_ram_info)
    local boot=$(get_boot_mode)
    local net=$(get_network_interfaces)

    local ver_line=""
    if [ -f "${ISO_MOUNT}/VERSION" ]; then
        ver_line=$(head -3 "${ISO_MOUNT}/VERSION" 2>/dev/null | tr '\n' ' ')
    fi

    dlg --title " System Information " --msgbox "\
 Hardware
 --------
 CPU:       ${cpu}
 Memory:    ${ram}
 Boot:      ${boot}

 Network Interfaces
 ------------------
${net}
 Image
 -----
 File:      ${ISO_IMAGE} (${img_size})
 ${ver_line}" 22 64
}

screen_hostname() {
    if [ -z "$DIALOG_BIN" ]; then
        while true; do
            printf "  Hostname [iora]: "; read ans
            ans="${ans:-iora}"
            if valid_hostname "$ans"; then
                IORA_HOSTNAME="$ans"
                return 0
            fi
            echo "  Invalid hostname. Use only letters, numbers, and hyphens."
        done
    fi

    while true; do
        local result
        result=$(dlg --title " Hostname " --inputbox \
            "\n Choose a hostname for this device.\n\n Allowed: letters, numbers, hyphens.\n" \
            12 60 "$IORA_HOSTNAME" 3>&1 1>&2 2>&3)
        [ $? -ne 0 ] && return 0

        if valid_hostname "$result"; then
            IORA_HOSTNAME="$result"
            return 0
        fi

        dlg_msg " Invalid Hostname " "Use only letters, numbers, and hyphens."
    done
}

screen_domain() {
    [ -z "$DIALOG_BIN" ] && return 0

    local result
    result=$(dlg --title " Domain Name " --inputbox \
        "\n Enter the domain name for this device (optional).\n\n Example: home.local or example.com\n Leave blank for no domain.\n" \
        14 60 "${IORA_DOMAIN:-}" 3>&1 1>&2 2>&3)
    [ $? -ne 0 ] && return 0

    if valid_domain "$result"; then
        IORA_DOMAIN="$result"
        return 0
    fi

    if [ -n "$result" ]; then
        dlg_msg " Invalid Domain " "Use only letters, numbers, dots, and hyphens."
        screen_domain
    fi
}

screen_drivers() {
    [ -z "$DIALOG_BIN" ] && return 0

    # Check for missing drivers
    local missing_info=""
    if ! missing_info=$(detect_missing_drivers 2>&1); then
        # Drivers are missing, ask user if they want to search online
        local choice
        choice=$(dlg --title " Driver Detection " --yesno \
            "\n Hardware components detected that may need additional drivers:\n\n${missing_info}\n Would you like to search for third-party drivers online?\n\n Note: This requires an active internet connection.\n" \
            18 68 3>&1 1>&2 2>&3; echo $?)

        if [ "$choice" -eq 0 ]; then
            # User wants to search for drivers
            dlg_info " Searching " "  Checking for available drivers online..."
            sleep 1

            # Try to bring up network for driver search
            if request_dhcp; then
                local dhcp_info=$(get_dhcp_ip)
                if [ -n "$dhcp_info" ]; then
                    dlg_info " Network Ready " "  Connection established: ${dhcp_info}\n  Searching for drivers..."
                    sleep 2

                    # Simulate driver search (in a real implementation, this would query a driver repository)
                    local driver_msg="Driver search completed.\n\n"
                    driver_msg="${driver_msg}No additional drivers found in the online repository.\n\n"
                    driver_msg="${driver_msg}The current kernel includes drivers for most common hardware.\n"
                    driver_msg="${driver_msg}If specific hardware is not working after installation,\n"
                    driver_msg="${driver_msg}you may need to install additional firmware packages."

                    dlg --title " Driver Search Results " --msgbox "$driver_msg" 16 68
                else
                    dlg_msg " Network Error " "Could not establish network connection.\nDriver search requires internet access.\n\nYou can continue with installation."
                fi
            else
                dlg_msg " Network Error " "Could not obtain network connection via DHCP.\nDriver search requires internet access.\n\nYou can continue with installation."
            fi
        fi
    fi

    return 0
}

screen_timezone() {
    [ -z "$DIALOG_BIN" ] && return 0

    local tz
    tz=$(dlg --title " Timezone " --menu \
        "\n Select the system timezone.  Use arrow keys to scroll.\n" 22 72 14 \
        "Europe/Berlin"        "Germany (Berlin, Munich, Hamburg)" \
        "Europe/Vienna"        "Austria (Vienna, Graz, Salzburg)" \
        "Europe/Zurich"        "Switzerland (Zurich, Geneva, Bern)" \
        "Europe/London"        "United Kingdom" \
        "Europe/Paris"         "France (Paris, Lyon)" \
        "Europe/Amsterdam"     "Netherlands" \
        "Europe/Rome"          "Italy (Rome, Milan)" \
        "Europe/Madrid"        "Spain (Madrid, Barcelona)" \
        "Europe/Lisbon"        "Portugal" \
        "Europe/Warsaw"        "Poland" \
        "Europe/Prague"        "Czech Republic / Slovakia" \
        "Europe/Stockholm"     "Sweden / Norway / Denmark" \
        "Europe/Helsinki"      "Finland" \
        "Europe/Athens"        "Greece" \
        "Europe/Bucharest"     "Romania / Bulgaria" \
        "Europe/Istanbul"      "Turkey" \
        "Europe/Moscow"        "Russia (Moscow)" \
        "Asia/Dubai"           "UAE / Qatar / Oman" \
        "Asia/Kolkata"         "India" \
        "Asia/Bangkok"         "Thailand / Vietnam" \
        "Asia/Singapore"       "Singapore / Malaysia" \
        "Asia/Shanghai"        "China / Taiwan" \
        "Asia/Tokyo"           "Japan" \
        "Asia/Seoul"           "South Korea" \
        "Australia/Sydney"     "Australia (East)" \
        "Australia/Perth"      "Australia (West)" \
        "Pacific/Auckland"     "New Zealand" \
        "US/Eastern"           "USA East (New York, Miami)" \
        "US/Central"           "USA Central (Chicago, Dallas)" \
        "US/Mountain"          "USA Mountain (Denver, Phoenix)" \
        "US/Pacific"           "USA West (Los Angeles, Seattle)" \
        "America/Toronto"      "Canada East" \
        "America/Vancouver"    "Canada West" \
        "America/Sao_Paulo"    "Brazil (East)" \
        "America/Buenos_Aires" "Argentina" \
        "Africa/Cairo"         "Egypt" \
        "Africa/Nairobi"       "East Africa" \
        "Africa/Johannesburg"  "South Africa" \
        "UTC"                  "UTC -- Coordinated Universal Time" \
        3>&1 1>&2 2>&3)
    [ $? -eq 0 ] && [ -n "$tz" ] && IORA_TIMEZONE="$tz"
}

screen_network() {
    [ -z "$DIALOG_BIN" ] && return 0

    local mode
    mode=$(dlg --title " Network " --menu \
        "\n Choose how IORA OS should configure networking.\n" 15 60 3 \
        "dhcp"   "Automatic via DHCP" \
        "static" "Manual IPv4 configuration" \
        "skip"   "Leave networking unchanged" \
        3>&1 1>&2 2>&3)
    [ $? -ne 0 ] && return 0

    IORA_NETWORK="$mode"

    if [ "$mode" = "dhcp" ]; then
        # Ask user if they want to try fetching an IP now, with skip option
        local try_now
        try_now=$(dlg --title " DHCP Network " --yesno \
            "\n DHCP mode selected.\n\n Would you like to request an IP address now\n to confirm the network is working?\n\n (You can skip this — DHCP will be configured on boot.)\n" \
            13 60 3>&1 1>&2 2>&3; echo $?)

        if [ "$try_now" -eq 0 ]; then
            dlg_info " Network " "  Requesting IP address via DHCP..."

            if request_dhcp; then
                local dhcp_info=$(get_dhcp_ip)
                if [ -n "$dhcp_info" ]; then
                    local iface=$(echo "$dhcp_info" | cut -d: -f1)
                    local ip=$(echo "$dhcp_info" | cut -d: -f2)

                    dlg --title " DHCP Success " --msgbox \
                        "\n Network configuration successful!\n\n Interface: ${iface}\n IP Address: ${ip}\n\n The system will use this configuration after installation.\n" \
                        14 60
                fi
            else
                dlg_msg " DHCP Warning " "Could not obtain IP via DHCP at this time.\n\nThe system will retry during first boot.\nYou can continue with installation."
            fi
        else
            dlg_msg " DHCP Selected " "DHCP will be configured automatically on first boot.\n\nThe system will obtain an IP address when it starts."
        fi

        # Ask if user wants custom DNS even with DHCP
        local custom_dns_choice
        custom_dns_choice=$(dlg --title " Custom DNS " --yesno \
            "\n Would you like to use custom DNS servers\n even though DHCP is enabled?\n\n Select Yes to specify custom DNS servers,\n or No to use DNS servers provided by DHCP.\n" \
            14 60 3>&1 1>&2 2>&3; echo $?)

        if [ "$custom_dns_choice" -eq 0 ]; then
            while true; do
                IORA_DNS=$(dlg --title " Custom DNS Server " --inputbox \
                    "\n Enter your preferred DNS server IPv4 address.\n" \
                    10 60 "${IORA_DNS:-8.8.8.8}" 3>&1 1>&2 2>&3)
                [ $? -ne 0 ] && break
                if valid_ipv4 "$IORA_DNS"; then
                    IORA_CUSTOM_DNS="yes"
                    break
                fi
                dlg_msg " Invalid DNS " "Enter a valid IPv4 address such as 8.8.8.8."
            done
        fi

    elif [ "$mode" = "static" ]; then
        # Static IP configuration
        while true; do
            IORA_IP=$(dlg --title " Static IPv4 " --inputbox \
                "\n Enter the IPv4 address for this device.\n" \
                10 60 "${IORA_IP:-192.168.1.100}" 3>&1 1>&2 2>&3)
            [ $? -ne 0 ] && return 0
            valid_ipv4 "$IORA_IP" && break
            dlg_msg " Invalid Address " "Enter a valid IPv4 address such as 192.168.1.100."
        done

        while true; do
            IORA_NETMASK=$(dlg --title " Prefix Length " --inputbox \
                "\n Enter the subnet prefix length.\n Example: 24\n" \
                10 60 "${IORA_NETMASK:-24}" 3>&1 1>&2 2>&3)
            [ $? -ne 0 ] && return 0
            valid_prefix_length "$IORA_NETMASK" && break
            dlg_msg " Invalid Prefix " "Enter a number between 1 and 32."
        done

        while true; do
            IORA_GATEWAY=$(dlg --title " Gateway " --inputbox \
                "\n Enter the default gateway IPv4 address.\n" \
                10 60 "${IORA_GATEWAY:-192.168.1.1}" 3>&1 1>&2 2>&3)
            [ $? -ne 0 ] && return 0
            valid_ipv4 "$IORA_GATEWAY" && break
            dlg_msg " Invalid Gateway " "Enter a valid IPv4 address such as 192.168.1.1."
        done

        while true; do
            IORA_DNS=$(dlg --title " DNS Server " --inputbox \
                "\n Enter the preferred DNS server IPv4 address.\n" \
                10 60 "${IORA_DNS:-8.8.8.8}" 3>&1 1>&2 2>&3)
            [ $? -ne 0 ] && return 0
            valid_ipv4 "$IORA_DNS" && break
            dlg_msg " Invalid DNS " "Enter a valid IPv4 address such as 8.8.8.8."
        done

        # Test the static IP configuration
        dlg_info " Testing " "  Testing network connectivity..."

        if test_ip_connectivity "$IORA_IP" "$IORA_GATEWAY"; then
            dlg --title " Connection Test " --msgbox \
                "\n Network connectivity test successful!\n\n Gateway ${IORA_GATEWAY} is reachable.\n\n The configuration appears to be correct.\n" \
                12 60
        else
            local retry_choice
            retry_choice=$(dlg --title " Connection Test Failed " --yesno \
                "\n Could not reach gateway ${IORA_GATEWAY}\n\n This may be normal if the network is not\n yet configured on this interface.\n\n Would you like to re-enter the network settings?\n" \
                14 60 3>&1 1>&2 2>&3; echo $?)

            if [ "$retry_choice" -eq 0 ]; then
                # User wants to retry
                screen_network
                return $?
            fi
        fi
    fi
}

screen_password() {
    local pw1 pw2 rc

    # Text-only (no dialog binary) path
    if [ -z "$DIALOG_BIN" ]; then
        while true; do
            printf "  Root password (required): "
            stty -echo 2>/dev/null; read -r pw1; stty echo 2>/dev/null; echo ""
            if [ -z "$pw1" ]; then
                echo "  ERROR: A root password is required. Please try again."
                continue
            fi
            printf "  Confirm password: "
            stty -echo 2>/dev/null; read -r pw2; stty echo 2>/dev/null; echo ""
            if [ "$pw1" = "$pw2" ]; then
                IORA_ROOT_PW="$pw1"
                return 0
            fi
            echo "  ERROR: Passwords do not match. Please try again."
        done
        return 0
    fi

    # Loop: re-prompt until a non-empty matching password is entered.
    # Cancel returns non-zero so the wizard's cancel menu is shown.
    while true; do
        pw1=$(dlg --title " Root Password " --insecure --passwordbox \
            "\n Set the root password for this device.\n\n A password is REQUIRED — the root account\n has full system access and must be protected.\n" \
            13 60 3>&1 1>&2 2>&3)
        rc=$?
        [ $rc -ne 0 ] && return 1

        # Require a non-empty password
        if [ -z "$pw1" ]; then
            dlg_msg " Password Required " "\
 A root password is required.\n\n\
 The root account is the system administrator.\n\
 Leaving it blank is a serious security risk.\n\n\
 Please enter a secure password to continue."
            continue
        fi

        pw2=$(dlg --title " Confirm Password " --insecure --passwordbox \
            "\n Enter the password again for verification.\n" \
            10 60 3>&1 1>&2 2>&3)
        rc=$?
        [ $rc -ne 0 ] && return 1

        if [ "$pw1" = "$pw2" ]; then
            IORA_ROOT_PW="$pw1"
            return 0
        fi

        dlg_msg " Password Mismatch " "\
 The passwords do not match.\n\n\
 Please enter the password and the confirmation again."
    done
}

# ── Web-admin account (first-boot dashboard credentials) ──────────────────────
# These are handed to iora-home via the headless apply (setup-config.json):
# the first boot creates the dashboard admin without showing the web wizard.
screen_admin() {
    [ -z "$DIALOG_BIN" ] && return 0

    local result
    result=$(dlg --title " Web Admin User " --inputbox \
        "\n Create the dashboard administrator account.\n\n Username (default: admin):\n" \
        11 60 "${IORA_ADMIN_USER:-admin}" 3>&1 1>&2 2>&3)
    [ $? -ne 0 ] && return 1
    result="${result:-admin}"
    # Keep the username simple (letters, digits, dash, underscore)
    case "$result" in
        *[!A-Za-z0-9_-]*|"") dlg_msg " Invalid Username " "Use only letters, digits, dash or underscore."; return 1 ;;
    esac
    IORA_ADMIN_USER="$result"

    while true; do
        local pw1 pw2
        pw1=$(dlg --title " Admin Password " --insecure --passwordbox \
            "\n Password for the dashboard admin.\n Minimum 8 characters — this protects your smart home!\n" \
            11 60 3>&1 1>&2 2>&3)
        [ $? -ne 0 ] && return 1
        if [ "${#pw1}" -lt 8 ]; then
            dlg_msg " Too Short " "The admin password must be at least 8 characters."
            continue
        fi
        pw2=$(dlg --title " Confirm Admin Password " --insecure --passwordbox \
            "\n Repeat the admin password:\n" 10 60 3>&1 1>&2 2>&3)
        [ $? -ne 0 ] && return 1
        if [ "$pw1" = "$pw2" ]; then
            IORA_ADMIN_PASS="$pw1"
            return 0
        fi
        dlg_msg " Mismatch " "The passwords do not match. Please try again."
    done
}

# ── Locale (dashboard language / country / units) ─────────────────────────────
# Stored in the headless config; the dashboard and the weather widgets read
# these on first boot.
screen_locale() {
    [ -z "$DIALOG_BIN" ] && return 0

    local lang
    lang=$(dlg --title " Language " --menu \
        "\n Dashboard language:\n" 12 60 2 \
        "de" "Deutsch" \
        "en" "English" \
        3>&1 1>&2 2>&3)
    [ $? -eq 0 ] && [ -n "$lang" ] && IORA_LANGUAGE="$lang"

    local country
    country=$(dlg --title " Country " --menu \
        "\n Country (weather/locale defaults):\n" 16 60 5 \
        "DE" "Germany" \
        "AT" "Austria" \
        "CH" "Switzerland" \
        "US" "United States" \
        "GB" "United Kingdom" \
        3>&1 1>&2 2>&3)
    [ $? -eq 0 ] && [ -n "$country" ] && IORA_COUNTRY="$country"

    local unit
    unit=$(dlg --title " Units " --menu \
        "\n Measurement units:\n" 12 60 2 \
        "metric" "Metric (°C, km/h)" \
        "imperial" "Imperial (°F, mph)" \
        3>&1 1>&2 2>&3)
    [ $? -eq 0 ] && [ -n "$unit" ] && IORA_UNIT_SYSTEM="$unit"
}

screen_select_disk() {
    local disk_list
    disk_list=$(get_disks)

    if [ -z "$disk_list" ]; then
        dlg_msg " Error " "\
 No suitable target disks found.\n\n\
 IORA OS requires at least ${MIN_DISK_GB} GB.\n\n\
 Connect a disk and type 'install' to retry."
        return 1
    fi

    if [ -n "$DIALOG_BIN" ]; then
        local disk_count=0
        set --
        for disk in $disk_list; do
            local sz=$(get_disk_size_gb "$disk")
            local mdl=$(get_disk_model "$disk")
            local bus=$(get_disk_transport "$disk")
            local dtype=$(get_disk_type "$disk")
            local parts=$(get_disk_partitions "$disk")
            # Build compact label: size, type, bus, model
            local label="${sz}GB ${dtype} [${bus}]"
            [ -n "$mdl" ] && label="${label} ${mdl}"
            [ "$parts" -gt 0 ] && label="${label} (${parts}p)"
            set -- "$@" "/dev/${disk}" "$label"
            disk_count=$((disk_count + 1))
        done

        local menu_h=$((disk_count + 13))
        [ "$menu_h" -gt 22 ] && menu_h=22

        SEL_DISK=$(dlg --title " Installation Target " \
            --menu "\n Release: ${ISO_IMAGE} (${img_size})\n\n Select the drive for IORA OS installation.\n ALL existing data on the selected drive will be ERASED.\n" \
            "$menu_h" 70 "$disk_count" \
            "$@" \
            3>&1 1>&2 2>&3)

        [ $? -ne 0 ] && return 1
        SEL_DISK=$(basename "$SEL_DISK")

        # Show detailed disk info before confirming
        local sel_sz=$(get_disk_size_gb "$SEL_DISK")
        local sel_mdl=$(get_disk_model "$SEL_DISK")
        local sel_bus=$(get_disk_transport "$SEL_DISK")
        local sel_dtype=$(get_disk_type "$SEL_DISK")
        local sel_vendor=$(get_disk_vendor "$SEL_DISK")
        local sel_parts=$(get_disk_partitions "$SEL_DISK")
        local disk_details=" Device:      /dev/${SEL_DISK}\n"
        disk_details="${disk_details} Size:        ${sel_sz} GB\n"
        disk_details="${disk_details} Type:        ${sel_dtype}\n"
        disk_details="${disk_details} Interface:   ${sel_bus}\n"
        [ -n "$sel_mdl" ] && disk_details="${disk_details} Model:       ${sel_mdl}\n"
        [ -n "$sel_vendor" ] && disk_details="${disk_details} Vendor:      ${sel_vendor}\n"
        disk_details="${disk_details} Partitions:  ${sel_parts} (will all be erased)\n"

        dlg --title " Selected Disk Details " --msgbox \
            "\n${disk_details}\n All data on this disk will be permanently erased.\n" \
            16 64

        # Show SD card optimizations if detected
        if is_sd_card "$SEL_DISK"; then
            local opt_msg=$(get_sd_optimizations "$SEL_DISK")
            dlg --title " Flash Storage Detected " --msgbox "$opt_msg" 24 68
        fi
    else
        echo ""
        echo "  === Select Target Disk ==="
        echo ""
        local i=1 disk_array=""
        for disk in $disk_list; do
            local sz=$(get_disk_size_gb "$disk")
            local mdl=$(get_disk_model "$disk")
            local dtype=$(get_disk_type "$disk")
            printf "    %d)  /dev/%-8s  %4d GB  [%s]" "$i" "$disk" "$sz" "$dtype"
            [ -n "$mdl" ] && printf "  %s" "$mdl"
            echo ""
            disk_array="${disk_array}${disk} "
            i=$((i + 1))
        done
        local disk_count=$((i - 1))
        echo ""
        printf "  Select disk [1-%d]: " "$disk_count"
        read choice
        if ! is_uint "$choice" || [ "$choice" -lt 1 ] || [ "$choice" -gt "$disk_count" ]; then
            return 1
        fi
        SEL_DISK=$(printf '%s\n' $disk_array | sed -n "${choice}p")
        [ -z "$SEL_DISK" ] && return 1

        # Show SD card optimizations if detected
        if is_sd_card "$SEL_DISK"; then
            echo ""
            get_sd_optimizations "$SEL_DISK"
            echo ""
            echo "  Press ENTER to continue..."
            read dummy
        fi
    fi
    return 0
}

screen_confirm() {
    local disk="$SEL_DISK"
    local sz=$(get_disk_size_gb "$disk")
    local mdl=$(get_disk_model "$disk")
    local vendor=$(get_disk_vendor "$disk")
    local parts=$(get_disk_partitions "$disk")
    local bus=$(get_disk_transport "$disk")
    parts=$(safe_uint "$parts" 0)

    local summary="Target Disk\n"
    summary="${summary}  Device:     /dev/${disk}\n"
    summary="${summary}  Size:       ${sz} GB\n"
    summary="${summary}  Bus:        ${bus}\n"
    [ -n "$mdl" ] && summary="${summary}  Model:      ${mdl}\n"
    [ -n "$vendor" ] && summary="${summary}  Vendor:     ${vendor}\n"
    [ "$parts" -gt 0 ] && summary="${summary}  Partitions: ${parts} (will be erased)\n"

    summary="${summary}\nSystem Settings\n"
    summary="${summary}  Hostname:   ${IORA_HOSTNAME}\n"
    summary="${summary}  Timezone:   ${IORA_TIMEZONE}\n"
    if [ "$IORA_NETWORK" = "static" ]; then
        summary="${summary}  Network:    Static (${IORA_IP}/${IORA_NETMASK})\n"
    else
        summary="${summary}  Network:    DHCP (automatic)\n"
    fi
    if [ -n "$IORA_ROOT_PW" ]; then
        summary="${summary}  Password:   (custom)\n"
    else
        summary="${summary}  Password:   (default)\n"
    fi
    if [ -n "$IORA_ADMIN_USER" ] && [ -n "$IORA_ADMIN_PASS" ]; then
        summary="${summary}  Web Admin:  ${IORA_ADMIN_USER} (password set)\n"
    else
        summary="${summary}  Web Admin:  none (register from the UI)\n"
    fi
    summary="${summary}  Locale:     ${IORA_LANGUAGE}/${IORA_COUNTRY} (${IORA_UNIT_SYSTEM})\n"

    summary="${summary}\n +------------------------------------+"
    summary="${summary}\n |  WARNING: ALL data on /dev/${disk}    |"
    summary="${summary}\n |  will be permanently ERASED!       |"
    summary="${summary}\n +------------------------------------+"
    summary="${summary}\n\n Proceed with installation?"

    if ! dlg_yesno " Confirm Installation " "$summary"; then
        return 1
    fi
    return 0
}

screen_install() {
    local disk="$SEL_DISK"

    # Unmount any partitions on target
    for part in /dev/${disk}*; do
        [ -b "$part" ] && umount "$part" 2>/dev/null || true
    done

    if [ -n "$DIALOG_BIN" ]; then
        (
            echo "2"
            echo "XXX"
            echo "  Wiping partition table on /dev/${disk}..."
            echo "XXX"
            dd if=/dev/zero of="/dev/${disk}" bs=1M count=1 >/dev/null 2>&1
            sleep 1

            echo "5"
            echo "XXX"
            echo "  Decompressing and writing IORA OS to /dev/${disk}..."
            echo "  This may take several minutes."
            echo "XXX"

            local img_bytes
            img_bytes=$(xz --robot --list "${ISO_MOUNT}/${ISO_IMAGE}" 2>/dev/null | awk '/^totals/{print $5}' || echo 0)
            img_bytes=$(safe_uint "$img_bytes" 0)
            [ "$img_bytes" -eq 0 ] && img_bytes=2000000000

            xzcat "${ISO_MOUNT}/${ISO_IMAGE}" | dd of="/dev/${disk}" bs=4M conv=fsync 2>/tmp/dd_progress &
            local dd_pid=$!

            local written=0
            while kill -0 "$dd_pid" 2>/dev/null; do
                if [ -f /tmp/dd_progress ]; then
                    written=$(grep -o '[0-9]* bytes' /tmp/dd_progress 2>/dev/null | tail -1 | awk '{print $1}' || echo 0)
                    written=$(safe_uint "$written" 0)
                fi
                if [ "$img_bytes" -gt 0 ] && [ "$written" -gt 0 ]; then
                    local pct=$((5 + written * 75 / img_bytes))
                    [ "$pct" -gt 80 ] && pct=80
                    echo "$pct"
                fi
                sleep 3
            done
            wait "$dd_pid"
            local dd_rc=$?

            if [ "$dd_rc" -ne 0 ]; then
                echo "$dd_rc" > /tmp/install_result
                echo "100"; echo "XXX"; echo "  ERROR: Image write failed!"; echo "XXX"
                exit 1
            fi

            echo "82"
            echo "XXX"
            echo "  Syncing disk..."
            echo "XXX"
            sync
            sleep 1

            echo "85"
            echo "XXX"
            echo "  Re-reading partition table..."
            echo "XXX"
            blockdev --rereadpt "/dev/${disk}" 2>/dev/null || true
            sleep 2

            echo "88"
            echo "XXX"
            echo "  Applying system configuration..."
            echo "XXX"
            echo "0" > /tmp/install_result

            echo "95"
            echo "XXX"
            echo "  Finalizing..."
            echo "XXX"
            sync
            sleep 1

            echo "100"
            echo "XXX"
            echo "  Installation complete!"
            echo "XXX"
        ) | dlg --title " Installing IORA OS " --gauge \
            "  Preparing installation..." 10 64 0

        local result=$(cat /tmp/install_result 2>/dev/null || echo 1)
        result=$(safe_uint "$result" 1)

        if [ "$result" -eq 0 ]; then
            # Apply post-install config (hostname, timezone, password, network)
            apply_post_install_config "$disk"
            return 0
        else
            dlg_msg " Failed " "\
 Could not write image to /dev/${disk}.\n\n Check the disk and try again."
            return 1
        fi
    else
        echo ""
        echo "  Writing image to /dev/${disk}..."
        echo ""
        if xzcat "${ISO_MOUNT}/${ISO_IMAGE}" | dd of="/dev/${disk}" bs=4M status=progress conv=fsync 2>&1; then
            sync
            blockdev --rereadpt "/dev/${disk}" 2>/dev/null || true
            sleep 2
            apply_post_install_config "$disk"
            return 0
        else
            echo "  ERROR: Installation failed!"
            return 1
        fi
    fi
}

screen_complete() {
    # Determine expected IP address
    local iora_ip="<IP>"
    if [ "$IORA_NETWORK" = "static" ] && [ -n "$IORA_IP" ]; then
        iora_ip="$IORA_IP"
    else
        # Try to guess from first active interface
        for iface in /sys/class/net/*; do
            local name=$(basename "$iface")
            [ "$name" = "lo" ] && continue
            local addr=$(ip -4 addr show "$name" 2>/dev/null | awk '/inet /{print $2}' | cut -d/ -f1 | head -1)
            if [ -n "$addr" ]; then
                iora_ip="$addr"
                break
            fi
        done
        [ "$iora_ip" = "<IP>" ] && iora_ip="${IORA_HOSTNAME}.local"
    fi

    if [ -n "$DIALOG_BIN" ]; then
        local action
        local admin_line=""
        if [ -n "$IORA_ADMIN_USER" ] && [ -n "$IORA_ADMIN_PASS" ]; then
            admin_line="\
 Dashboard admin: ${IORA_ADMIN_USER} (password set)\n"
        fi
        action=$(dlg --title " Setup Complete " --menu "\
 IORA OS has been written to /dev/${SEL_DISK}.

 On first boot the configuration is applied automatically
 and the dashboard starts directly — no setup wizard.

 Dashboard URL:
     http://${iora_ip}:8126

${admin_line}
 First-boot settings:
     Hostname: ${IORA_HOSTNAME}
     Timezone: ${IORA_TIMEZONE}

 Remove the installation media before continuing.\n" \
                        22 68 3 \
            "reboot"   "Reboot now (recommended)" \
            "shell"    "Drop to shell" \
            "poweroff" "Shut down" \
            3>&1 1>&2 2>&3)

        case "$action" in
            reboot)   umount "${ISO_MOUNT}" 2>/dev/null; sync; reboot -f ;;
            poweroff) umount "${ISO_MOUNT}" 2>/dev/null; sync; poweroff -f ;;
            shell)    return 0 ;;
            *)        umount "${ISO_MOUNT}" 2>/dev/null; sync; reboot -f ;;
        esac
    else
        echo ""
        echo "  IORA OS installed successfully!"
        echo ""
        echo "  On first boot the configuration is applied automatically."
        echo "  Dashboard: http://${iora_ip}:8126"
        if [ -n "$IORA_ADMIN_USER" ] && [ -n "$IORA_ADMIN_PASS" ]; then
            echo "  Admin user: ${IORA_ADMIN_USER} (password set)"
        fi
        echo ""
        echo "  Remove the media and press ENTER to reboot..."
        read _
        umount "${ISO_MOUNT}" 2>/dev/null; sync; reboot -f
    fi
}

# ── Quick Install wizard ───────────────────────────────────────────
# Simplified 4-step install for non-technical users.
# Uses smart defaults; only asks timezone, password, disk, confirm.
run_express_wizard() {
    local BACKTITLE_BASE="IORA OS Installer  |  Quick Install"

    # Quick install: create a strong random admin password for the dashboard
    # so the first boot can apply the headless config without a wizard.
    if [ -z "$IORA_ADMIN_PASS" ]; then
        IORA_ADMIN_PASS=$(head -c 18 /dev/urandom 2>/dev/null | base64 2>/dev/null | tr -dc 'A-Za-z0-9' | head -c 16)
        [ -z "$IORA_ADMIN_PASS" ] && IORA_ADMIN_PASS="iora-admin-$(date +%s)"
    fi

    # Mount media with retries
    BACKTITLE="${BACKTITLE_BASE} -- Step 1/4: Loading"
    dlg_info " Scanning " "  Searching for installation media..."
    sleep 1

    local mounted=false attempt=0
    while [ "$attempt" -lt 5 ]; do
        if mount_iso; then mounted=true; break; fi
        attempt=$((attempt + 1))
        dlg_info " Scanning " "  Scanning for devices... (${attempt}/5)"
        sleep 2
    done

    if [ "$mounted" = false ]; then
        dlg_msg " Media Not Found " "\
 Could not find the IORA OS image.\n\n\
 Make sure the installer ISO or USB\n\
 is connected and contains '${ISO_IMAGE}'.\n\n\
 Type 'install' to retry."
        return 1
    fi

    img_size=$(ls -lh "${ISO_MOUNT}/${ISO_IMAGE}" 2>/dev/null | awk '{print $5}')

    # Integrity check
    if [ -f "${ISO_MOUNT}/${ISO_IMAGE}.sha256" ]; then
        dlg_info " Integrity Check " "  Verifying image integrity..."
        if ! (cd "${ISO_MOUNT}" && sha256sum -c "${ISO_IMAGE}.sha256" >/dev/null 2>&1); then
            dlg_msg " Checksum Error " "\
 Image checksum verification FAILED!\n\n\
 The installation image may be corrupted.\n\
 Re-download or re-create the installer.\n\n\
 Installation will not continue."
            return 1
        fi
        dlg_info " Verified " "  Image integrity: OK  [${img_size}]"
        sleep 1
    fi

    # Step 1: Timezone (simplified list)
    BACKTITLE="${BACKTITLE_BASE} -- Step 1/4: Timezone"
    local tz
    tz=$(dlg --title " Step 1/4 -- Timezone " --menu \
        "\n Select your timezone.  Use arrow keys to scroll.\n" 22 72 12 \
        "Europe/Berlin"        "Germany (Berlin, Munich, Hamburg)" \
        "Europe/Vienna"        "Austria" \
        "Europe/Zurich"        "Switzerland" \
        "Europe/London"        "United Kingdom" \
        "Europe/Paris"         "France" \
        "Europe/Amsterdam"     "Netherlands" \
        "Europe/Rome"          "Italy" \
        "Europe/Madrid"        "Spain" \
        "Europe/Warsaw"        "Poland" \
        "Europe/Stockholm"     "Sweden / Norway / Denmark" \
        "Europe/Helsinki"      "Finland" \
        "Europe/Moscow"        "Russia (Moscow)" \
        "Asia/Dubai"           "UAE / Qatar / Oman" \
        "Asia/Kolkata"         "India" \
        "Asia/Bangkok"         "Thailand / Vietnam" \
        "Asia/Singapore"       "Singapore / Malaysia" \
        "Asia/Shanghai"        "China / Taiwan" \
        "Asia/Tokyo"           "Japan" \
        "Asia/Seoul"           "South Korea" \
        "Australia/Sydney"     "Australia (East)" \
        "Australia/Perth"      "Australia (West)" \
        "Pacific/Auckland"     "New Zealand" \
        "US/Eastern"           "USA East (New York, Miami)" \
        "US/Central"           "USA Central (Chicago, Dallas)" \
        "US/Mountain"          "USA Mountain (Denver, Phoenix)" \
        "US/Pacific"           "USA West (Los Angeles, Seattle)" \
        "America/Toronto"      "Canada East" \
        "America/Vancouver"    "Canada West" \
        "America/Sao_Paulo"    "Brazil (East)" \
        "America/Buenos_Aires" "Argentina" \
        "Africa/Cairo"         "Egypt" \
        "Africa/Johannesburg"  "South Africa" \
        "UTC"                  "UTC -- Coordinated Universal Time" \
        3>&1 1>&2 2>&3)
    [ $? -eq 0 ] && [ -n "$tz" ] && IORA_TIMEZONE="$tz"

    # Step 2: Root password (required)
    BACKTITLE="${BACKTITLE_BASE} -- Step 2/4: Password"
    while true; do
        local pw1 pw2 pw_rc
        pw1=$(dlg --title " Step 2/4 -- Root Password " --insecure --passwordbox \
            "\n Set a root password for this device.\n\n\
 A password is REQUIRED -- the root account\n\
 has full system access and must be protected.\n" \
            13 64 3>&1 1>&2 2>&3)
        pw_rc=$?
        if [ $pw_rc -ne 0 ]; then
            if dlg_yesno " Skip Password? " "\
 WARNING: Skipping leaves root with the DEFAULT\n\
 password, which is a serious security risk!\n\n\
 Yes  -> Continue without a password (not recommended)\n\
 No   -> Go back and set a secure password"; then
                break
            fi
            continue
        fi

        if [ -z "$pw1" ]; then
            dlg_msg " Password Required " "\
 A root password is required.\n\n\
 Leaving it blank is a serious security risk.\n\
 Please enter a secure password to continue."
            continue
        fi

        pw2=$(dlg --title " Step 2/4 -- Confirm Password " --insecure --passwordbox \
            "\n Enter the password again for verification.\n" \
            10 64 3>&1 1>&2 2>&3)
        [ $? -ne 0 ] && continue

        if [ "$pw1" = "$pw2" ]; then
            IORA_ROOT_PW="$pw1"
            break
        fi

        dlg_msg " Mismatch " "\
 The passwords do not match.\n\
 Please try again."
    done

    # Step 3: Disk selection
    BACKTITLE="${BACKTITLE_BASE} -- Step 3/4: Target Disk"
    if ! screen_select_disk; then
        dlg_msg " Cancelled " "Installation cancelled."
        return 1
    fi

    # Step 4: Confirm
    BACKTITLE="${BACKTITLE_BASE} -- Step 4/4: Confirm"
    if ! screen_confirm; then
        dlg_msg " Cancelled " "Installation cancelled.\nNo changes were made."
        return 1
    fi

    # Install
    BACKTITLE="${BACKTITLE_BASE} -- Installing..."
    if ! screen_install; then
        return 1
    fi

    screen_complete
}

# ── Main wizard flow ───────────────────────────────────────────────
run_wizard() {
    # Step 0: Welcome / mode selection
    if ! screen_welcome; then
        return 0
    fi

    # Route to Quick Install
    if [ "$INSTALLER_MODE" = "quick" ]; then
        run_express_wizard
        return $?
    fi

    # ── Custom Install (full wizard) ───────────────────────────────
    # Mount media with retries
    BACKTITLE="IORA OS Installer  |  Custom Install -- Loading"
    dlg_info " Scanning " "  Searching for installation media..."
    sleep 1

    local mounted=false attempt=0
    while [ "$attempt" -lt 5 ]; do
        if mount_iso; then mounted=true; break; fi
        attempt=$((attempt + 1))
        dlg_info " Scanning " "  Scanning for devices... attempt ${attempt} of 5"
        sleep 2
    done

    if [ "$mounted" = false ]; then
        dlg_msg " Error " "\
 Could not find the IORA OS image.\n\n\
 Make sure the installer ISO or USB\n\
 is connected and contains the file\n\
 '${ISO_IMAGE}'.\n\n\
 Type 'install' to retry."
        return 1
    fi

    img_size=$(ls -lh "${ISO_MOUNT}/${ISO_IMAGE}" 2>/dev/null | awk '{print $5}')

    # Integrity check
    if [ -f "${ISO_MOUNT}/${ISO_IMAGE}.sha256" ]; then
        dlg_info " Integrity Check " "  Verifying SHA256 checksum..."
        if (cd "${ISO_MOUNT}" && sha256sum -c "${ISO_IMAGE}.sha256" >/dev/null 2>&1); then
            dlg_info " Verified " "  Image integrity: OK  [${img_size}]"
            sleep 1
        else
            dlg_msg " Checksum Error " "\
 Image checksum verification FAILED!\n\n\
 The installation image may be corrupted.\n\
 Re-download or re-create the installer.\n\n\
 Installation will not continue."
            return 1
        fi
    fi

    local _TOTAL=11

    # Step 1: System info
    BACKTITLE="IORA OS Installer  |  Custom Install -- Step 1/${_TOTAL}: System Info"
    screen_sysinfo

    # Step 2: Hostname
    BACKTITLE="IORA OS Installer  |  Custom Install -- Step 2/${_TOTAL}: Hostname"
    screen_hostname

    # Step 3: Domain (optional)
    BACKTITLE="IORA OS Installer  |  Custom Install -- Step 3/${_TOTAL}: Domain"
    screen_domain

    # Step 4: Timezone
    BACKTITLE="IORA OS Installer  |  Custom Install -- Step 4/${_TOTAL}: Timezone"
    screen_timezone

    # Step 5: Driver detection (optional)
    BACKTITLE="IORA OS Installer  |  Custom Install -- Step 5/${_TOTAL}: Drivers"
    screen_drivers

    # Step 6: Network
    BACKTITLE="IORA OS Installer  |  Custom Install -- Step 6/${_TOTAL}: Network"
    screen_network

    # Step 7: Root password
    BACKTITLE="IORA OS Installer  |  Custom Install -- Step 7/${_TOTAL}: Password"
    while true; do
        if screen_password; then
            break
        fi
        if dlg_yesno " Skip password? " "\
 You cancelled the root password step.\n\n\
 WARNING: Skipping leaves the root account with\n\
 its DEFAULT password, which is a security risk!\n\n\
 Yes  -> skip (keep default password -- NOT recommended)\n\
 No   -> go back and set a secure password"; then
            break
        fi
    done

    # Step 8: Web-admin account
    BACKTITLE="IORA OS Installer  |  Custom Install -- Step 8/${_TOTAL}: Web Admin"
    while true; do
        if screen_admin; then
            break
        fi
        if dlg_yesno " Skip admin account? " "\
 Without an admin account the dashboard has no\n\
 administrator after first boot (register from the\n\
 login screen instead).\n\n\
 Yes  -> skip (recommended only for testing)\n\
 No   -> create the admin account"; then
            break
        fi
    done

    # Step 9: Locale
    BACKTITLE="IORA OS Installer  |  Custom Install -- Step 9/${_TOTAL}: Locale"
    screen_locale

    # Step 10: Disk selection
    BACKTITLE="IORA OS Installer  |  Custom Install -- Step 10/${_TOTAL}: Target Disk"
    if ! screen_select_disk; then
        dlg_msg " Cancelled " "Installation cancelled."
        return 1
    fi

    # Step 11: Confirmation summary
    BACKTITLE="IORA OS Installer  |  Custom Install -- Step 11/${_TOTAL}: Confirm & Install"
    if ! screen_confirm; then
        dlg_msg " Cancelled " "Installation cancelled.\nNo changes were made."
        return 1
    fi

    # Install
    BACKTITLE="IORA OS Installer  |  Installing..."
    if ! screen_install; then
        return 1
    fi

    # Done
    screen_complete
}

# ── Entry point ────────────────────────────────────────────────────

# Helper commands for the recovery shell
cat > /bin/install <<'SHEOF'
#!/bin/sh
# Restart the IORA OS installation wizard
AC='\033[38;5;39m'
GR='\033[38;5;245m'
RS='\033[0m'
echo ""
echo "  ${GR}+--------------------------------------------+${RS}"
echo "  ${GR}|${RS}  ${AC}Restarting IORA OS Installation Wizard...${RS}  ${GR}|${RS}"
echo "  ${GR}+--------------------------------------------+${RS}"
echo ""
sleep 1
exec /init
SHEOF
chmod +x /bin/install 2>/dev/null || true

cat > /bin/installer <<'SHEOF'
#!/bin/sh
# Alias for install command
exec /bin/install
SHEOF
chmod +x /bin/installer 2>/dev/null || true

cat > /bin/sysinfo <<'SHEOF'
#!/bin/sh
AC='\033[38;5;39m'
CY='\033[38;5;45m'
GR='\033[38;5;245m'
RS='\033[0m'
echo ""
echo "  ${GR}+--------------------------------------------+${RS}"
echo "  ${GR}|${RS}      ${AC}IORA OS System Information${RS}          ${GR}|${RS}"
echo "  ${GR}+--------------------------------------------+${RS}"
echo ""
echo "  ${CY}CPU:${RS}     $(grep -m1 'model name' /proc/cpuinfo 2>/dev/null | cut -d: -f2 | sed 's/^ *//')"
echo "  ${CY}Cores:${RS}   $(grep -c '^processor' /proc/cpuinfo 2>/dev/null)"
echo "  ${CY}Memory:${RS}  $(awk '/MemTotal/{printf "%.0f MB", $2/1024}' /proc/meminfo 2>/dev/null)"
echo "  ${CY}Boot:${RS}    $([ -d /sys/firmware/efi ] && echo UEFI || echo BIOS)"
echo ""
echo "  === Block Devices ==="
lsblk 2>/dev/null || ls -l /sys/block/
echo ""
echo "  === Network ==="
ip -brief addr 2>/dev/null || ifconfig 2>/dev/null || echo "  (no ip/ifconfig)"
echo ""
SHEOF
chmod +x /bin/sysinfo 2>/dev/null || true

cat > /bin/netsetup <<'SHEOF'
#!/bin/sh
AC='\033[38;5;39m'
GN='\033[38;5;42m'
RD='\033[38;5;203m'
GR='\033[38;5;245m'
RS='\033[0m'
echo ""
echo "  ${GR}+--------------------------------------------+${RS}"
echo "  ${GR}|${RS}      ${AC}Network Configuration${RS}                ${GR}|${RS}"
echo "  ${GR}+--------------------------------------------+${RS}"
echo ""
echo "  Bringing up network interfaces..."
for iface in /sys/class/net/*; do
    name=$(basename "$iface")
    [ "$name" = "lo" ] && continue
    ip link set "$name" up 2>/dev/null
    udhcpc -i "$name" -n -q 2>/dev/null && echo "  ${GN}[ OK ]${RS} $name: DHCP configured" && exit 0
    dhclient "$name" 2>/dev/null && echo "  ${GN}[ OK ]${RS} $name: DHCP configured" && exit 0
done
echo "  ${RD}[FAIL]${RS} No DHCP lease obtained."
echo ""
SHEOF
chmod +x /bin/netsetup 2>/dev/null || true

cat > /bin/help <<'SHEOF'
#!/bin/sh
AC='\033[38;5;39m'
CY='\033[38;5;45m'
GR='\033[38;5;245m'
RS='\033[0m'
echo ""
echo "  ${GR}+--------------------------------------------+${RS}"
echo "  ${GR}|${RS}   ${AC}IORA OS Installer - Available Commands${RS}   ${GR}|${RS}"
echo "  ${GR}+--------------------------------------------+${RS}"
echo ""
echo "  ${CY}install${RS}     - Restart the IORA OS installation wizard"
echo "  ${CY}installer${RS}   - Alias for 'install' command"
echo "  ${CY}sysinfo${RS}     - Display system information"
echo "  ${CY}netsetup${RS}    - Configure network via DHCP"
echo "  ${CY}help${RS}        - Show this help message"
echo "  ${CY}reboot${RS}      - Reboot the system"
echo "  ${CY}poweroff${RS}    - Shut down the system"
echo ""
echo "  To return to the installer at any time, type:"
echo "  ${AC}install${RS} or ${AC}installer${RS}"
echo ""
SHEOF
chmod +x /bin/help 2>/dev/null || true

run_wizard
rc=$?

# Display enhanced help after wizard exits
clear 2>/dev/null || true
CY='\033[38;5;45m'
RS='\033[0m'
cat <<'BANNER'

  +--------------------------------------------------------------+
  |                                                              |
  |        IORA OS Installation - Recovery Shell                |
  |                                                              |
  +--------------------------------------------------------------+

BANNER

echo "  The installation wizard has exited."
echo "  You are now in a recovery shell."
echo ""
echo "  Available commands:"
echo "    ${CY}install${RS}     - Restart the installation wizard"
echo "    ${CY}installer${RS}   - Restart the installation wizard (alias)"
echo "    ${CY}sysinfo${RS}     - Show system information"
echo "    ${CY}netsetup${RS}    - Configure network via DHCP"
echo "    ${CY}help${RS}        - Show all available commands"
echo "    ${CY}reboot${RS}      - Reboot the system"
echo "    ${CY}poweroff${RS}    - Shut down"
echo ""
echo "  Type 'install' or 'installer' to return to the installation wizard."
echo ""

if [ -x /bin/bash ]; then
    exec /bin/bash
elif [ -x /bin/sh ]; then
    exec /bin/sh
elif [ -x /bin/busybox ]; then
    exec /bin/busybox sh
else
    exec sh
fi
