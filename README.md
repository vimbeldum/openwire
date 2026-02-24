# OpenWire

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
├── .gitignore              # Git ignore rules
└── src/
    ├── main.rs             # Application entry point, CLI parsing
    ├── crypto.rs           # Key generation, identity management
    ├── network/
    │   └── mod.rs          # libp2p swarm, behaviors, peer management
    ├── ui/
    │   └── mod.rs          # Terminal UI (ratatui) rendering
    └── web/
        └── mod.rs          # Axum web server and HTML templates
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

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/openwire.git
cd openwire

# Build the project
cargo build --release

# Run
cargo run --release
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

### Encryption (Noise)
- XX handshake pattern for mutual authentication
- Forward secrecy for all communications
- Each session uses unique ephemeral keys

---

## Development Status

🚧 **Early Development** - This project is in active development.

### Roadmap

- [x] Project scaffolding
- [x] Core networking layer
- [x] Encryption implementation
- [x] Terminal UI
- [x] Web interface
- [ ] File transfer support
- [ ] Cross-platform builds

---

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## License

MIT License - see [LICENSE](LICENSE) for details.

---

## Acknowledgments

- [libp2p](https://libp2p.io/) - Modular peer-to-peer networking stack
- [ratatui](https://github.com/ratatui-org/ratatui) - Rust terminal UI library
- [axum](https://github.com/tokio-rs/axum) - Ergonomic web framework

---

**Built with ❤️ in Rust**
