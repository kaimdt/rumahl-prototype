# Buildroot external tree for IORA OS.
# Package makefiles can be included here when custom packages are added.

include $(sort $(wildcard $(BR2_EXTERNAL_IORA_PATH)/package/*/*.mk))
