# OpenWire Makefile
# Common commands for development

.PHONY: all build run test clean fmt clippy check help

# Default target
all: check test

# Build the project
build:
	cargo build --release

# Build in debug mode
build-debug:
	cargo build

# Run the application
run:
	cargo run

# Run with common options
run-dev:
	cargo run -- --nick "Dev" --log-level debug

# Run with web interface
run-web:
	cargo run -- --web --web-port 3000 --log-level debug

# Run all tests
test:
	cargo test

# Run tests with verbose output
test-verbose:
	cargo test -- --nocapture

# Run clippy linter
clippy:
	cargo clippy --all-targets -- -D warnings

# Format code
fmt:
	cargo fmt

# Check formatting without making changes
fmt-check:
	cargo fmt -- --check

# Run all checks (fmt, clippy, test)
check: fmt-check clippy test

# Clean build artifacts
clean:
	cargo clean

# Update dependencies
update:
	cargo update

# Build documentation
docs:
	cargo doc --no-deps --open

# Build documentation including private items
docs-all:
	cargo doc --document-private-items --open

# Check for outdated dependencies
outdated:
	cargo outdated

# Security audit
audit:
	cargo audit

# Install required tools
install-tools:
	cargo install cargo-audit
	cargo install cargo-outdated

# Create a release build for current platform
release: build
	@echo "Release binary at: target/release/openwire"

# Run with release optimizations
run-release:
	cargo run --release

# Display help
help:
	@echo "OpenWire Development Commands"
	@echo "============================="
	@echo ""
	@echo "Building:"
	@echo "  make build         - Build release binary"
	@echo "  make build-debug   - Build debug binary"
	@echo "  make release       - Build and show binary location"
	@echo ""
	@echo "Running:"
	@echo "  make run           - Run the application"
	@echo "  make run-dev       - Run with debug logging"
	@echo "  make run-web       - Run with web interface"
	@echo "  make run-release   - Run release build"
	@echo ""
	@echo "Testing & Quality:"
	@echo "  make test          - Run all tests"
	@echo "  make test-verbose  - Run tests with verbose output"
	@echo "  make clippy        - Run clippy linter"
	@echo "  make fmt           - Format code"
	@echo "  make fmt-check     - Check formatting"
	@echo "  make check         - Run all checks (fmt, clippy, test)"
	@echo ""
	@echo "Utilities:"
	@echo "  make clean         - Remove build artifacts"
	@echo "  make update        - Update dependencies"
	@echo "  make docs          - Build and open documentation"
	@echo "  make outdated      - Check for outdated dependencies"
	@echo "  make audit         - Security audit"
	@echo "  make install-tools - Install cargo tools"
	@echo "  make help          - Show this help message"
