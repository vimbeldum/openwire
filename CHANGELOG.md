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
