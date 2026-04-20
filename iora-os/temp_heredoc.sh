#!/bin/sh
export PATH=/sbin:/usr/sbin:/bin:/usr/bin
export TERM=linux
export NCURSES_NO_UTF8_ACS=1

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

# Load modules
for mod in cdrom sr_mod iso9660 loop isofs sd_mod ahci virtio_blk virtio_pci; do
    modprobe "$mod" 2>/dev/null || true
done

# ── Configuration ──────────────────────────────────────────────────
ISO_MOUNT="/mnt/iso"
ISO_IMAGE="iora-os.img.xz"
MIN_DISK_GB=8
BACKTITLE="IORA OS Installer  |  Use Tab/Arrow keys to navigate, Enter to confirm"
IORA_HOSTNAME="iora"
IORA_TIMEZONE="Europe/Berlin"
IORA_NETWORK="dhcp"

# ── Dialog color theme (Ubuntu/Debian terminal-installer style) ──
setup_dialog_theme() {
    cat > /tmp/.dialogrc <<'DLGRC'
aspect = 0
separate_widget = ""
tab_len = 0
visit_items = OFF
use_shadow = ON
use_colors = ON
screen_color = (WHITE,BLUE,ON)
shadow_color = (BLACK,BLACK,ON)
dialog_color = (BLACK,WHITE,OFF)
title_color = (YELLOW,BLUE,ON)
border_color = (WHITE,BLUE,ON)
border2_color = (WHITE,BLUE,ON)
button_active_color = (WHITE,BLUE,ON)
button_inactive_color = (BLACK,WHITE,OFF)
button_key_active_color = (YELLOW,BLUE,ON)
button_key_inactive_color = (RED,WHITE,OFF)
button_label_active_color = (YELLOW,BLUE,ON)
button_label_inactive_color = (BLACK,WHITE,ON)
inputbox_color = (BLACK,WHITE,OFF)
inputbox_border_color = (WHITE,BLUE,ON)
searchbox_color = (BLACK,WHITE,OFF)
searchbox_title_color = (YELLOW,BLUE,ON)
searchbox_border_color = (WHITE,BLUE,ON)
position_indicator_color = (YELLOW,BLUE,ON)
menubox_color = (BLACK,WHITE,OFF)
menubox_border_color = (WHITE,BLUE,ON)
item_color = (BLACK,WHITE,OFF)
item_selected_color = (WHITE,BLUE,ON)
tag_color = (YELLOW,BLUE,ON)
tag_selected_color = (WHITE,BLUE,ON)
tag_key_color = (YELLOW,BLUE,ON)
tag_key_selected_color = (WHITE,BLUE,ON)
check_color = (BLACK,WHITE,OFF)
check_selected_color = (WHITE,BLUE,ON)
uarrow_color = (GREEN,BLUE,ON)
darrow_color = (GREEN,BLUE,ON)
gauge_color = (WHITE,BLUE,ON)
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
    for disk_path in /sys/block/sd* /sys/block/vd* /sys/block/nvme*; do
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
        *)       echo "Unknown" ;;
    esac
}

# ── Post-install configuration ─────────────────────────────────────
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

    # Set timezone
    if [ -n "$IORA_TIMEZONE" ] && [ -f "${target}/usr/share/zoneinfo/${IORA_TIMEZONE}" ]; then
        ln -sf "/usr/share/zoneinfo/${IORA_TIMEZONE}" "${target}/etc/localtime" 2>/dev/null || true
        echo "$IORA_TIMEZONE" > "${target}/etc/timezone" 2>/dev/null || true
    fi

    # Set root password if changed
    if [ -n "$IORA_ROOT_PW" ]; then
        local salt=$(head -c 16 /dev/urandom 2>/dev/null | od -A n -t x1 | tr -d ' \n' | head -c 16)
        local hash=$(echo "$IORA_ROOT_PW" | openssl passwd -6 -stdin -salt "$salt" 2>/dev/null || true)
        if [ -n "$hash" ] && [ -f "${target}/etc/shadow" ]; then
            sed -i "s|^root:[^:]*:|root:${hash}:|" "${target}/etc/shadow" 2>/dev/null || true
        fi
    fi

    # Configure static network if chosen
    if [ "$IORA_NETWORK" = "static" ] && [ -n "$IORA_IP" ]; then
        mkdir -p "${target}/etc/systemd/network" 2>/dev/null || true
        cat > "${target}/etc/systemd/network/10-static.network" <<NETEOF
[Match]
Name=eth* en*

[Network]
Address=${IORA_IP}/${IORA_NETMASK:-24}
Gateway=${IORA_GATEWAY:-}
DNS=${IORA_DNS:-8.8.8.8}
NETEOF
    fi

    sync
    umount "$target" 2>/dev/null || true
    return 0
}

# ── Wizard screens ─────────────────────────────────────────────────

screen_welcome() {
    if [ -n "$DIALOG_BIN" ]; then
                dlg --title " IORA OS Setup " --msgbox "\
 Ready to deploy IORA OS.

 This guided setup will:
     1. Inspect this system
     2. Configure hostname and timezone
     3. Configure network settings
     4. Set the root password
     5. Write the image to the selected drive

 Expect the installation itself to take a few minutes.
 All data on the selected target drive will be erased.

 Select OK to continue." 18 68
    else
        clear 2>/dev/null || true
        echo ""
                echo "  IORA OS Setup"
                echo "  ============="
        echo ""
        echo "  Press ENTER to begin..."
        read _
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

screen_timezone() {
    [ -z "$DIALOG_BIN" ] && return 0

    local tz
    tz=$(dlg --title " Timezone " --menu \
        "\n Select the system timezone.\n" 20 60 10 \
        "Europe/Berlin"    "Germany" \
        "Europe/Vienna"    "Austria" \
        "Europe/Zurich"    "Switzerland" \
        "Europe/London"    "United Kingdom" \
        "Europe/Paris"     "France" \
        "Europe/Amsterdam" "Netherlands" \
        "Europe/Rome"      "Italy" \
        "Europe/Madrid"    "Spain" \
        "US/Eastern"       "US East Coast" \
        "US/Pacific"       "US West Coast" \
        "UTC"              "Coordinated Universal Time" \
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

    if [ "$mode" = "static" ]; then
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
    fi
}

screen_password() {
    [ -z "$DIALOG_BIN" ] && return 0

    local pw1 pw2

    pw1=$(dlg --title " Root Password " --insecure --passwordbox \
        "\n Set a new root password.\n Leave this blank to keep the default.\n" \
        12 60 3>&1 1>&2 2>&3)
    [ $? -ne 0 ] && return 0
    [ -z "$pw1" ] && return 0

    pw2=$(dlg --title " Confirm Password " --insecure --passwordbox \
        "\n Enter the password again for verification.\n" \
        10 60 3>&1 1>&2 2>&3)
    [ $? -ne 0 ] && return 0

    if [ "$pw1" != "$pw2" ]; then
        dlg_msg " Password Mismatch " "The passwords do not match. The default password will remain active."
        return 0
    fi

    IORA_ROOT_PW="$pw1"
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
            local label="${sz}GB ${bus}"
            [ -n "$mdl" ] && label="${label} - ${mdl}"
            set -- "$@" "/dev/${disk}" "$label"
            disk_count=$((disk_count + 1))
        done

        local menu_h=$((disk_count + 12))
        [ "$menu_h" -gt 22 ] && menu_h=22

        SEL_DISK=$(dlg --title " Installation Target " \
            --menu "\n Release: ${ISO_IMAGE} (${img_size})\n\n Select the drive that should receive IORA OS.\n All existing data on the selected drive will be erased.\n" \
            "$menu_h" 64 "$disk_count" \
            "$@" \
            3>&1 1>&2 2>&3)

        [ $? -ne 0 ] && return 1
        SEL_DISK=$(basename "$SEL_DISK")
    else
        echo ""
        echo "  === Select Target Disk ==="
        echo ""
        local i=1 disk_array=""
        for disk in $disk_list; do
            local sz=$(get_disk_size_gb "$disk")
            local mdl=$(get_disk_model "$disk")
            printf "    %d)  /dev/%-8s  %4d GB" "$i" "$disk" "$sz"
            [ -n "$mdl" ] && printf "  [%s]" "$mdl"
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
                action=$(dlg --title " Setup Complete " --menu "\
 IORA OS has been written to /dev/${SEL_DISK}.

 Next step after reboot:
     http://${iora_ip}:8080

 First-boot settings:
     Hostname: ${IORA_HOSTNAME}
     Timezone: ${IORA_TIMEZONE}

 Remove the installation media before continuing.\n" \
                        18 64 3 \
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
        echo "  After rebooting, open a browser:"
        echo "    http://${iora_ip}:8080"
        echo ""
        echo "  Remove the media and press ENTER to reboot..."
        read _
        umount "${ISO_MOUNT}" 2>/dev/null; sync; reboot -f
    fi
}

# ── Main wizard flow ───────────────────────────────────────────────
run_wizard() {
    # Step 0: Welcome
    screen_welcome

    # Mount media with retries
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

    # Step 1: System info
    screen_sysinfo

    # Step 2: Hostname
    screen_hostname

    # Step 3: Timezone
    screen_timezone

    # Step 4: Network
    screen_network

    # Step 5: Root password
    screen_password

    # Step 6: Disk selection
    if ! screen_select_disk; then
        dlg_msg " Cancelled " "Installation cancelled."
        return 1
    fi

    # Step 7: Confirmation summary
    if ! screen_confirm; then
        dlg_msg " Cancelled " "Installation cancelled.\nNo changes were made."
        return 1
    fi

    # Step 8: Install
    if ! screen_install; then
        return 1
    fi

    # Step 9: Done
    screen_complete
}

# ── Entry point ────────────────────────────────────────────────────

# Helper commands for the recovery shell
cat > /bin/install <<'SHEOF'
#!/bin/sh
exec /init
SHEOF
chmod +x /bin/install 2>/dev/null || true

cat > /bin/sysinfo <<'SHEOF'
#!/bin/sh
echo ""
echo "  === System Information ==="
echo "  CPU:     $(grep -m1 'model name' /proc/cpuinfo 2>/dev/null | cut -d: -f2 | sed 's/^ *//')"
echo "  Cores:   $(grep -c '^processor' /proc/cpuinfo 2>/dev/null)"
echo "  Memory:  $(awk '/MemTotal/{printf "%.0f MB", $2/1024}' /proc/meminfo 2>/dev/null)"
echo "  Boot:    $([ -d /sys/firmware/efi ] && echo UEFI || echo BIOS)"
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
echo "  Bringing up network interfaces..."
for iface in /sys/class/net/*; do
    name=$(basename "$iface")
    [ "$name" = "lo" ] && continue
    ip link set "$name" up 2>/dev/null
    udhcpc -i "$name" -n -q 2>/dev/null && echo "  $name: DHCP OK" && exit 0
    dhclient "$name" 2>/dev/null && echo "  $name: DHCP OK" && exit 0
done
echo "  No DHCP lease obtained."
SHEOF
chmod +x /bin/netsetup 2>/dev/null || true

run_wizard
rc=$?

echo ""
echo "  Available commands:"
echo "    install  - Restart the installation wizard"
echo "    sysinfo  - Show system information"
echo "    netsetup - Configure network via DHCP"
echo "    reboot   - Reboot the system"
echo "    poweroff - Shut down"
echo ""

if [ -x /bin/bash ]; then
    exec /bin/bash
elif [ -x /bin/sh ]; then
    exec /bin/sh
elif [ -x /bin/busybox ]; then
