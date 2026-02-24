# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

### Changed

### Deprecated

### Removed

### Fixed

### Security

---

## [0.2.1] - 2026-02-24

### Added

- **Room Access Control**
  - Room invites now target a specific peer ID
  - Only the intended recipient can accept invites
  - Only room members can invite others to the room
  - Private rooms are truly private - no unauthorized access

### Changed

- Improved UI layout with separate Rooms panel in sidebar
- Peer invite now works with short peer IDs shown in UI
- Message scrolling stops at first message (no more blank scrolling)

### Fixed

- Help display now shows all features with proper formatting
- Clippy warnings in media module resolved

---

## [0.2.0] - 2026-02-24

### Added

- **Private Group Chat Rooms**
  - `/room create <name>` - Create encrypted private rooms
  - `/room invite <peer> <room>` - Invite peers to rooms
  - `/room list` - List joined rooms
  - `/room leave <room>` - Leave a room
  - Room-specific encryption with ChaCha20-Poly1305
  - Signed room invites with X25519 key exchange

- **Message Scrolling**
  - Up/Down arrows to scroll message history
  - PageUp/PageDown for fast scrolling
  - Visual scrollbar indicator
  - Auto-scroll to bottom on new messages

- **Media Support**
  - Optional image support with `--features image-support`
  - `/image <file>` command to send images
  - ASCII art fallback for terminals without image protocol support
  - Supports PNG, JPEG, GIF, BMP, WebP formats

- **Open Source Project Files**
  - CONTRIBUTING.md with development guidelines
  - CODE_OF_CONDUCT.md (Contributor Covenant)
  - SECURITY.md with vulnerability reporting process
  - Issue templates (bug report, feature request)
  - Pull request template
  - Dependabot configuration
  - CI workflow with test, clippy, fmt checks
  - Pre-commit hooks configuration

### Changed

- Updated README with badges and improved documentation
- Improved error handling in room commands

### Fixed

- String slicing panics in UI code
- Clippy warnings for manual string stripping

---

## [0.1.0] - 2024-01-15

### Added

- Initial release of OpenWire
- End-to-end encryption using X25519 + ChaCha20-Poly1305
- Message signing with Ed25519
- Peer discovery via mDNS
- Secure transport via Noise protocol
- Terminal UI with 3-pane layout (messages, peers, input)
- File transfer support with signature verification
- Optional web interface with REST API
- Cross-platform support (Linux, macOS, Windows)
- CLI with configurable options (port, nickname, logging level)
- Bootstrap peer support for initial connections

### Security

- Ed25519 signatures for message authentication
- X25519 key exchange with ephemeral keys for forward secrecy
- ChaCha20-Poly1305 AEAD encryption
- HKDF key derivation with random salt
- Zeroization of sensitive key material
- Timestamp validation for replay protection
- Signed key exchange to prevent MITM attacks

---

## Release Notes Template

When releasing a new version, use this template:

```markdown
## [X.Y.Z] - YYYY-MM-DD

### Added
- New features

### Changed
- Changes to existing functionality

### Deprecated
- Features to be removed in future releases

### Removed
- Features removed in this release

### Fixed
- Bug fixes

### Security
- Security improvements and vulnerability fixes
```
