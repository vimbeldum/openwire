# OpenWire

[![CI](https://github.com/shwetanshu21/openwire/actions/workflows/ci.yml/badge.svg)](https://github.com/shwetanshu21/openwire/actions/workflows/ci.yml)
[![Release](https://github.com/shwetanshu21/openwire/actions/workflows/release.yml/badge.svg)](https://github.com/shwetanshu21/openwire/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Rust](https://img.shields.io/badge/rust-1.70%2B-orange.svg)](https://www.rust-lang.org/)
[![GitHub release](https://img.shields.io/github/v/release/shwetanshu21/openwire?include_prereleases)](https://github.com/shwetanshu21/openwire/releases)

**Decentralized P2P Local Network Messenger** - Encrypted, Anonymous, Zero-Config

---

## Overview

OpenWire is a peer-to-peer local network messenger built in Rust. It enables secure, decentralized communication between devices on the same network without requiring any central server or configuration.

### Key Features

- 🔒 **End-to-End Encryption** - All messages encrypted using Noise protocol
- 🌐 **Zero Configuration** - Automatic peer discovery via mDNS
- 📡 **Decentralized** - No central server, pure P2P architecture
- 💬 **Group Messaging** - Gossipsub protocol for efficient broadcast
- 🖥️ **Multiple Interfaces** - Terminal UI (ratatui) and optional web interface (axum)
- 🚀 **High Performance** - Built with async Rust and Tokio runtime

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        OpenWire Node                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │  Terminal   │  │    Web      │  │      Network        │ │
│  │  UI (TUI)   │  │  Interface  │  │      Layer          │ │
│  │  (ratatui)  │  │   (axum)    │  │     (libp2p)        │ │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘ │
│         │                │                    │            │
│         └────────────────┴────────────────────┘            │
│                          │                                  │
│                   ┌──────▼──────┐                          │
│                   │    Core     │                          │
│                   │   Message   │                          │
│                   │    Router   │                          │
│                   └──────┬──────┘                          │
│                          │                                  │
│                   ┌──────▼──────┐                          │
│                   │   Crypto    │                          │
│                   │  (ed25519)  │                          │
│                   └─────────────┘                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| **Language** | Rust (stable) | Memory safety, performance |
| **Async Runtime** | Tokio | Async I/O, task scheduling |
| **P2P Networking** | libp2p | Peer-to-peer communication |
| **Peer Discovery** | mDNS | Local network discovery |
| **Message Broadcasting** | Gossipsub | Efficient pub/sub messaging |
| **Encryption** | Noise Protocol | Secure authenticated encryption |
| **Cryptography** | ed25519-dalek | Digital signatures, identity |
| **Terminal UI** | ratatui | Rich terminal interface |
| **Web Interface** | axum | HTTP server for web UI |
| **Logging** | tracing | Structured logging and diagnostics |

---

## Project Structure

```
openwire/
├── Cargo.toml              # Project dependencies and metadata
├── README.md               # This file
├── CONTRIBUTING.md         # Contribution guidelines
├── CHANGELOG.md            # Version history
├── CODE_OF_CONDUCT.md      # Community standards
├── SECURITY.md             # Security policy
├── LICENSE                 # MIT License
├── Makefile                # Common development commands
├── .editorconfig           # Editor configuration
├── entitlements.plist      # macOS network entitlements
├── Formula/
│   └── openwire.rb         # Homebrew Formula
├── .github/
│   ├── workflows/
│   │   ├── ci.yml          # CI pipeline (test, lint, fmt)
│   │   └── release.yml     # Cross-platform release pipeline
│   ├── ISSUE_TEMPLATE/     # Issue templates
│   ├── PULL_REQUEST_TEMPLATE.md
│   ├── dependabot.yml      # Dependency updates
│   ├── FUNDING.yml         # Sponsorship options
│   └── codecov.yml         # Coverage configuration
└── src/
    ├── main.rs             # Application entry point, CLI parsing
    ├── crypto.rs           # Key generation, identity, signing
    ├── encryption.rs       # E2E encryption (X25519 + ChaCha20)
    ├── network/
    │   └── mod.rs          # libp2p swarm, peer mgmt, file transfer
    ├── ui/
    │   └── mod.rs          # Terminal UI (ratatui) 3-pane layout
    └── web/
        └── mod.rs          # Axum web server and REST API
```

---

## Module Descriptions

### `main.rs`
- CLI argument parsing
- Application initialization
- Coordination between UI, network, and web layers
- Graceful shutdown handling

### `crypto.rs`
- Ed25519 key pair generation
- Peer identity management
- Message signing and verification
- Cryptographic utilities

### `network/mod.rs`
- libp2p Swarm setup and management
- mDNS peer discovery implementation
- Gossipsub message broadcasting
- Noise protocol encryption handshake
- Peer connection lifecycle

### `ui/mod.rs`
- ratatui terminal interface
- Message display and input handling
- Peer list visualization
- Keyboard navigation

### `web/mod.rs`
- axum HTTP server
- REST API endpoints
- WebSocket support for real-time updates
- HTML template rendering

---

## Getting Started

### Prerequisites

- Rust 1.70+ (stable)
- Cargo (comes with Rust)

### Installation

#### Homebrew (macOS — recommended)

Builds from source on your machine, bypassing Gatekeeper entirely:

```bash
brew tap shwetanshu21/openwire https://github.com/shwetanshu21/openwire
brew install openwire
```

#### Prebuilt Binaries

Download from [GitHub Releases](https://github.com/shwetanshu21/openwire/releases):

| Platform | File |
|----------|------|
| macOS Apple Silicon | `openwire-macos-arm.tar.gz` |
| macOS Intel | `openwire-macos-intel.tar.gz` |
| Linux x86_64 | `openwire-linux-x86_64.tar.gz` |
| Windows x86_64 | `openwire-windows-x86_64.zip` |

```bash
# macOS / Linux
tar xzf openwire-macos-arm.tar.gz
./openwire -n "YourName"
```

#### Build from Source

```bash
git clone https://github.com/shwetanshu21/openwire.git
cd openwire
cargo build --release
./target/release/openwire -n "YourName"
```

### Usage

```bash
# Start with terminal UI (default)
cargo run

# Start with web interface on custom port
cargo run -- --web --port 8080

# Connect to a specific peer
cargo run -- --bootstrap /ip4/192.168.1.100/tcp/4001

# Enable debug logging
RUST_LOG=debug cargo run
```

---

## Configuration

OpenWire is designed to be zero-configuration. However, some options can be customized:

| Option | Default | Description |
|--------|---------|-------------|
| `--port` | 0 (random) | TCP port for P2P listening |
| `--web` | false | Enable web interface |
| `--web-port` | 3000 | Port for web interface |
| `--bootstrap` | none | Bootstrap peer multiaddress |
| `--nick` | random | Display nickname |

---

## Protocol Details

### Peer Discovery (mDNS)
- Automatic discovery of peers on the same LAN
- No manual configuration required
- Works across different operating systems

### Message Routing (Gossipsub)
- Efficient broadcast to all connected peers
- Mesh-based routing for scalability
- Message deduplication and validation

### Encryption
- **Key Exchange**: X25519 Diffie-Hellman with ephemeral keys for forward secrecy
- **AEAD**: ChaCha20-Poly1305 for authenticated encryption
- **Signing**: Ed25519 for message authentication
- **KDF**: HKDF-SHA256 with random salt per message
- **Transport**: Noise protocol (XX handshake)

---

## macOS Notes

**Firewall prompt**: On first run, macOS will ask *"Do you want the application 'openwire' to accept incoming network connections?"* — click **Allow**.

If you installed via `brew install`, the binary is built locally and won't trigger Gatekeeper warnings.

If you downloaded a prebuilt binary and macOS blocks it:

```bash
# Remove the quarantine flag
xattr -d com.apple.quarantine ./openwire
```

If peers can't find you, check the firewall:

1. **System Settings** → **Network** → **Firewall**
2. Click **Options** and ensure `openwire` is set to **Allow**

---

## Development Status

**Active Development** - This project is actively maintained.

### Roadmap

- [x] Project scaffolding
- [x] Core networking layer
- [x] Encryption implementation
- [x] Terminal UI
- [x] Web interface
- [x] File transfer support
- [x] Cross-platform builds
- [ ] Message persistence
- [ ] Direct encrypted messaging
- [ ] Mobile companion app

---

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

Quick start:
1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes and run `make check` to verify
4. Commit your changes (`git commit -m 'feat: add amazing feature'`)
5. Push to the branch (`git push origin feature/amazing-feature`)
6. Open a Pull Request

Please read our [Code of Conduct](CODE_OF_CONDUCT.md) before contributing.

---

## License

MIT License - see [LICENSE](LICENSE) for details.

---

## Documentation

- [Contributing Guide](CONTRIBUTING.md) - How to contribute to OpenWire
- [Code of Conduct](CODE_OF_CONDUCT.md) - Community standards
- [Security Policy](SECURITY.md) - Reporting security vulnerabilities
- [Changelog](CHANGELOG.md) - Version history and changes

---

## Support

- 🐛 [Report a Bug](https://github.com/shwetanshu21/openwire/issues/new?template=bug_report.md)
- 💡 [Request a Feature](https://github.com/shwetanshu21/openwire/issues/new?template=feature_request.md)
- 💬 [Discussions](https://github.com/shwetanshu21/openwire/discussions)

---

## Acknowledgments

- [libp2p](https://libp2p.io/) - Modular peer-to-peer networking stack
- [ratatui](https://github.com/ratatui-org/ratatui) - Rust terminal UI library
- [axum](https://github.com/tokio-rs/axum) - Ergonomic web framework

---

**Built with Rust**
