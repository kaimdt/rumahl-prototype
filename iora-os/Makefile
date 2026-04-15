# IORA OS Build System Makefile
# Simplified interface for building all image formats

.PHONY: all help install-deps build clean distclean release

# Default target
all: build

# Show help
help:
	@echo "IORA OS Build System"
	@echo ""
	@echo "Available targets:"
	@echo "  make install-deps  - Install build dependencies"
	@echo "  make build         - Build all image formats"
	@echo "  make clean         - Clean build artifacts"
	@echo "  make distclean     - Clean everything including downloads"
	@echo "  make release       - Create release package"
	@echo "  make help          - Show this help"
	@echo ""
	@echo "Quick start:"
	@echo "  sudo make install-deps"
	@echo "  make build"
	@echo ""

# Install build dependencies (requires sudo)
install-deps:
	@echo "Installing build dependencies..."
	sudo apt-get update
	sudo apt-get install -y \
		build-essential \
		git \
		wget \
		tar \
		gzip \
		xz-utils \
		cpio \
		unzip \
		rsync \
		bc \
		libncurses5-dev \
		libssl-dev \
		python3 \
		python3-pip \
		qemu-utils \
		virtualbox \
		zip \
		rauc
	@echo "Dependencies installed successfully"

# Build all images
build:
	@echo "Building IORA OS (all formats)..."
	./build-all-images.sh

# Clean build artifacts (keep downloads)
clean:
	@echo "Cleaning build artifacts..."
	rm -rf buildroot-*/output
	rm -rf releases
	@echo "Clean complete"

# Clean everything including downloads
distclean:
	@echo "Cleaning everything..."
	rm -rf buildroot-*
	rm -rf releases
	@echo "Distclean complete"

# Create release package
release: build
	@echo "Creating release package..."
	@latest=$$(ls -dt releases/*/ | head -1); \
	tar czf iora-os-release.tar.gz -C "$$latest" .
	@echo "Release package created: iora-os-release.tar.gz"
