################################################################################
#
# rumahl-runtime-sensor-ebpf-loader
#
################################################################################

RUMAHL_RUNTIME_SENSOR_EBPF_LOADER_VERSION = 1.0
RUMAHL_RUNTIME_SENSOR_EBPF_LOADER_SITE = $(BR2_EXTERNAL_RUMAHL_PATH)/package/rumahl-runtime-sensor-ebpf-loader
RUMAHL_RUNTIME_SENSOR_EBPF_LOADER_SITE_METHOD = local
RUMAHL_RUNTIME_SENSOR_EBPF_LOADER_LICENSE = GPL-2.0
RUMAHL_RUNTIME_SENSOR_EBPF_LOADER_LICENSE_FILES = src/loader.c
RUMAHL_RUNTIME_SENSOR_EBPF_LOADER_DEPENDENCIES = linux libbpf host-clang host-bpftool

# The capture program, the shared wire-format header and the userspace
# consumer live next to the sensor service sources.
RUMAHL_RUNTIME_SENSOR_EBPF_LOADER_SRC_DIR = $(BR2_EXTERNAL_RUMAHL_PATH)/backend/services/rumahl-runtime-sensor/ebpf

define RUMAHL_RUNTIME_SENSOR_EBPF_LOADER_EXTRACT_CMDS
	cp $(RUMAHL_RUNTIME_SENSOR_EBPF_LOADER_SRC_DIR)/runtime.bpf.c $(@D)/
	cp $(RUMAHL_RUNTIME_SENSOR_EBPF_LOADER_SRC_DIR)/runtime_event.h $(@D)/
	cp $(RUMAHL_RUNTIME_SENSOR_EBPF_LOADER_SRC_DIR)/loader.c $(@D)/
endef

define RUMAHL_RUNTIME_SENSOR_EBPF_LOADER_BUILD_CMDS
	# vmlinux.h is generated from the built kernel image (CO-RE/BTF).
	$(HOST_DIR)/bin/bpftool btf dump file $(LINUX_DIR)/vmlinux format c \
		> $(@D)/vmlinux.h
	$(HOST_DIR)/bin/clang -target bpf -g -O2 -Wall -I$(@D) -c \
		$(@D)/runtime.bpf.c -o $(@D)/runtime.bpf.o
	$(TARGET_CC) $(TARGET_CFLAGS) $(TARGET_CPPFLAGS) \
		-I$(STAGING_DIR)/usr/include $(@D)/loader.c \
		-o $(@D)/rumahl-runtime-sensor-ebpf-loader \
		$(TARGET_LDFLAGS) -lbpf -lelf -lz
endef

define RUMAHL_RUNTIME_SENSOR_EBPF_LOADER_INSTALL_TARGET_CMDS
	$(INSTALL) -D -m 0755 $(@D)/rumahl-runtime-sensor-ebpf-loader \
		$(TARGET_DIR)/usr/lib/ora/rumahl-runtime-sensor-ebpf-loader
	$(INSTALL) -D -m 0644 $(@D)/runtime.bpf.o \
		$(TARGET_DIR)/usr/lib/ora/runtime.bpf.o
endef

$(eval $(generic-package))
