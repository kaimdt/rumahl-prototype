#!/bin/bash
# RAUC update hook script

case "$1" in
    install-check)
        # Pre-installation checks
        echo "Checking available disk space..."
        AVAILABLE=$(df /mnt/data | tail -1 | awk '{print $4}')
        if [ "$AVAILABLE" -lt 1048576 ]; then
            echo "ERROR: Insufficient disk space"
            exit 1
        fi
        ;;

    install)
        echo "Installing IORA OS update..."
        # Stop IORA services before update
        systemctl stop iora-stack.service
        ;;

    post-install)
        echo "Update installed successfully"
        # Services will start automatically on next boot
        ;;

    *)
        echo "Unknown hook: $1"
        exit 1
        ;;
esac

exit 0
