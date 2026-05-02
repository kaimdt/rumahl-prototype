################################################################################
#
# iora-dev-toolchain
#
################################################################################

IORA_DEV_TOOLCHAIN_VERSION = 1.90.0
IORA_DEV_TOOLCHAIN_SITE = https://static.rust-lang.org/dist
IORA_DEV_TOOLCHAIN_LICENSE = Apache-2.0 or MIT

ifeq ($(BR2_aarch64),y)
IORA_DEV_TOOLCHAIN_RUST_TRIPLE = aarch64-unknown-linux-gnu
else ifeq ($(BR2_x86_64),y)
IORA_DEV_TOOLCHAIN_RUST_TRIPLE = x86_64-unknown-linux-gnu
endif

IORA_DEV_TOOLCHAIN_SOURCE = rust-$(IORA_DEV_TOOLCHAIN_VERSION)-$(IORA_DEV_TOOLCHAIN_RUST_TRIPLE).tar.xz
IORA_DEV_TOOLCHAIN_DEPENDENCIES = \
	binutils \
	clang \
	git \
	make \
	nodejs \
	openssl \
	pkgconf \
	postgresql \
	python3

# Rust's installer is already built for the target architecture. Install it
# directly into the target rootfs; DEV images deliberately carry this bulk so
# device-side builds do not depend on Docker image pulls.
define IORA_DEV_TOOLCHAIN_INSTALL_TARGET_CMDS
	cd $(@D) && ./install.sh \
		--prefix=/usr/local \
		--destdir=$(TARGET_DIR) \
		--disable-ldconfig \
		--components=rustc,cargo,rust-std-$(IORA_DEV_TOOLCHAIN_RUST_TRIPLE)
	mkdir -p $(TARGET_DIR)/usr/bin
	ln -sf /usr/local/bin/cargo $(TARGET_DIR)/usr/bin/cargo
	ln -sf /usr/local/bin/rustc $(TARGET_DIR)/usr/bin/rustc
	ln -sf /usr/local/bin/rustdoc $(TARGET_DIR)/usr/bin/rustdoc
	if [ -x $(TARGET_DIR)/usr/bin/clang ]; then \
		ln -sf /usr/bin/clang $(TARGET_DIR)/usr/bin/cc; \
		ln -sf /usr/bin/clang $(TARGET_DIR)/usr/bin/gcc; \
	fi
	if [ -x $(TARGET_DIR)/usr/bin/clang++ ]; then \
		ln -sf /usr/bin/clang++ $(TARGET_DIR)/usr/bin/c++; \
		ln -sf /usr/bin/clang++ $(TARGET_DIR)/usr/bin/g++; \
	fi
endef

$(eval $(generic-package))
