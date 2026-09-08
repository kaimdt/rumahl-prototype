################################################################################
#
# rumahl-dev-toolchain
#
################################################################################

RUMAHL_DEV_TOOLCHAIN_VERSION = 1.90.0
RUMAHL_DEV_TOOLCHAIN_SITE = https://static.rust-lang.org/dist
RUMAHL_DEV_TOOLCHAIN_LICENSE = Apache-2.0 or MIT

ifeq ($(BR2_aarch64),y)
RUMAHL_DEV_TOOLCHAIN_RUST_TRIPLE = aarch64-unknown-linux-gnu
else ifeq ($(BR2_x86_64),y)
RUMAHL_DEV_TOOLCHAIN_RUST_TRIPLE = x86_64-unknown-linux-gnu
endif

RUMAHL_DEV_TOOLCHAIN_SOURCE = rust-$(RUMAHL_DEV_TOOLCHAIN_VERSION)-$(RUMAHL_DEV_TOOLCHAIN_RUST_TRIPLE).tar.xz
RUMAHL_DEV_TOOLCHAIN_DEPENDENCIES = \
	binutils \
	ca-certificates \
	clang \
	cmake \
	git \
	libcurl \
	make \
	nodejs \
	openssl \
	perl \
	pkgconf \
	postgresql \
	python3

# Rust's installer is already built for the target architecture. Install it
# directly into the target rootfs; DEV images deliberately carry this bulk so
# device-side builds do not depend on Docker image pulls.
define RUMAHL_DEV_TOOLCHAIN_INSTALL_TARGET_CMDS
	cd $(@D) && ./install.sh \
		--prefix=/usr/local \
		--destdir=$(TARGET_DIR) \
		--disable-ldconfig \
		--components=rustc,cargo,rust-std-$(RUMAHL_DEV_TOOLCHAIN_RUST_TRIPLE)
	mkdir -p $(TARGET_DIR)/usr/bin
	ln -sf /usr/local/bin/cargo $(TARGET_DIR)/usr/bin/cargo
	ln -sf /usr/local/bin/rustc $(TARGET_DIR)/usr/bin/rustc
	ln -sf /usr/local/bin/rustdoc $(TARGET_DIR)/usr/bin/rustdoc
	mkdir -p $(TARGET_DIR)/usr/include $(TARGET_DIR)/usr/lib $(TARGET_DIR)/usr/share
	if [ -d $(STAGING_DIR)/usr/include ]; then \
		cp -a $(STAGING_DIR)/usr/include/. $(TARGET_DIR)/usr/include/; \
	fi
	if [ -d $(STAGING_DIR)/usr/lib/pkgconfig ]; then \
		mkdir -p $(TARGET_DIR)/usr/lib/pkgconfig; \
		cp -a $(STAGING_DIR)/usr/lib/pkgconfig/. $(TARGET_DIR)/usr/lib/pkgconfig/; \
	fi
	if [ -d $(STAGING_DIR)/usr/share/pkgconfig ]; then \
		mkdir -p $(TARGET_DIR)/usr/share/pkgconfig; \
		cp -a $(STAGING_DIR)/usr/share/pkgconfig/. $(TARGET_DIR)/usr/share/pkgconfig/; \
	fi
	if [ -d $(STAGING_DIR)/usr/lib/cmake ]; then \
		mkdir -p $(TARGET_DIR)/usr/lib/cmake; \
		cp -a $(STAGING_DIR)/usr/lib/cmake/. $(TARGET_DIR)/usr/lib/cmake/; \
	fi
	if [ -d $(STAGING_DIR)/usr/share/cmake ]; then \
		mkdir -p $(TARGET_DIR)/usr/share/cmake; \
		cp -a $(STAGING_DIR)/usr/share/cmake/. $(TARGET_DIR)/usr/share/cmake/; \
	fi
	find $(STAGING_DIR)/usr/lib -maxdepth 1 \( -name '*.so' -o -name '*.so.*' -o -name '*.a' -o -name 'crt*.o' -o -name 'Scrt*.o' \) \
		-exec cp -a -P {} $(TARGET_DIR)/usr/lib/ \; 2>/dev/null || true
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
