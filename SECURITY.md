# Security Policy

## Supported Versions

We release patches for security vulnerabilities. Currently supported versions:

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

We take the security of OpenWire seriously. If you believe you have found a security vulnerability, please report it to us as described below.

### How to Report

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, please report them using GitHub's Security Advisory feature:

1. Go to the [Security Advisories](https://github.com/vimbeldum/openwire/security/advisories) page
2. Click "Report a vulnerability"
3. Fill in the details of the vulnerability

Alternatively, you can email the maintainer directly if GitHub's advisory feature is unavailable.

### What to Include

Please include the following information in your report:

- **Description**: A clear description of the vulnerability
- **Impact**: What an attacker could achieve by exploiting this vulnerability
- **Reproduction**: Step-by-step instructions to reproduce the issue
- **Proof of Concept**: If available, a minimal example demonstrating the vulnerability
- **Suggested Fix**: If you have ideas for how to fix the issue
- **Your Contact Info**: So we can follow up with questions

### Response Timeline

- **Initial Response**: Within 48 hours
- **Status Update**: Within 7 days
- **Resolution Target**: Critical vulnerabilities within 30 days

### Disclosure Policy

- We follow responsible disclosure practices
- We will credit you in the security advisory (unless you prefer to remain anonymous)
- We request that you do not disclose the vulnerability publicly until a fix has been released
- We will publish a security advisory on GitHub once a fix is available

## Security Features

OpenWire implements the following security measures:

### Cryptography

- **Key Exchange**: X25519 ECDH for secure session establishment
- **Encryption**: ChaCha20-Poly1305 AEAD encryption for all peer-to-peer messages
- **Signatures**: Ed25519 for message authentication
- **Key Derivation**: HKDF-SHA256 with random salt
- **Forward Secrecy**: Ephemeral keys generated per message

### Transport Security

- **Noise Protocol**: Secure transport layer via libp2p
- **mDNS**: Signed key exchange to prevent MITM on discovery

### Data Protection

- **Zeroization**: Private keys are securely wiped from memory
- **No Persistent Keys**: Keys are generated fresh on startup (no key storage vulnerabilities)

### Known Limitations

- **Broadcast Messages**: General topic messages are signed but not encrypted (intentional for group chat)
- **Key Persistence**: No persistent identity (keys regenerated on restart)
- **Clock Sync**: Timestamp validation requires reasonably synchronized clocks (60s tolerance)

## Security Best Practices for Users

1. **Verify Peer IDs**: When security is critical, verify peer IDs through a separate channel
2. **Network Isolation**: Use on trusted networks when possible
3. **Keep Updated**: Always use the latest version of OpenWire
4. **Report Issues**: Report any suspicious behavior or vulnerabilities

## Security Changelog

### Version 0.1.0
- Initial security implementation with E2E encryption
- Ed25519 signatures for all messages
- Signed key exchange protocol
- Timestamp-based replay protection

---

Thank you for helping keep OpenWire and its users safe!
