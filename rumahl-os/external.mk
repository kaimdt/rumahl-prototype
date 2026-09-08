# Buildroot external tree for rumahl OS.
# Package makefiles can be included here when custom packages are added.

include $(sort $(wildcard $(BR2_EXTERNAL_RUMAHL_PATH)/package/*/*.mk))
