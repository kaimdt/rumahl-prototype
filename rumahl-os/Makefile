# rumahl OS Build System Makefile
# Simplified interface for building all image formats

.PHONY: all help install-deps install-deps-linux install-deps-wsl build resume clean distclean release

# Default target
all: build

# Show help
help:
	@echo "rumahl OS Build System"
	@echo ""
	@echo "Available targets:"
	@echo "  make install-deps  - Install build dependencies (auto-detect Linux VM vs WSL)"
	@echo "  make install-deps-linux - Install build dependencies for native Linux VM/host"
	@echo "  make install-deps-wsl - Install build dependencies for WSL"
	@echo "  make build         - Build all image formats"
	@echo "  make resume        - Resume interrupted build (with progress)"
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
	@echo "Installing build dependencies (auto-detect mode)..."
	bash ./install-requirements.sh --auto

# Install Linux build dependencies (explicit)
install-deps-linux:
	@echo "Installing Linux VM/host build dependencies..."
	bash ./install-requirements-linux.sh

# Install WSL build dependencies
install-deps-wsl:
	@echo "Installing WSL build dependencies..."
	bash ./install-requirements-wsl.sh

# Build all images
build:
	@echo "Building rumahl OS (all formats)..."
	./build-all-images.sh

# Resume interrupted build
resume:
	@echo "Resuming rumahl OS build..."
	bash ./resume-build.sh --progress

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
	tar czf rumahl-os-release.tar.gz -C "$$latest" .
	@echo "Release package created: rumahl-os-release.tar.gz"
