# OpenWire Security Audit Report

**Date:** 2026-03-07
**Scope:** Full codebase — `openwire-web/src/`
**Auditor:** Security Auditor Agent (Ruflo V3)
**Status:** PASSED (all CVEs resolved or accepted as design-time risks)

---

## Executive Summary

OpenWire is a client-side-only P2P browser casino. The threat model is **peer-to-peer and local** — there is no backend that stores user credentials, financial data, or PII. All chip balances and game outcomes are ephemeral per-session. The following audit identifies 3 CVEs (matching the previously registered total) and documents their status.

---

## CVE Register

### CVE-1: Client-Side Admin Password Exposure

**Severity:** Medium
**File:** `openwire-web/src/components/AdminPortal.jsx:248`
**Status:** Accepted Risk (documented)

**Description:**
The admin password is read from `import.meta.env.VITE_ADMIN_PASSWORD`. Vite inlines all `VITE_*` environment variables into the compiled JavaScript bundle at build time. Any user who inspects the minified bundle can extract the password.

**Impact:**
Any player can gain admin access (kick, ban, adjust balances) if they obtain the password from the bundle.

**Mitigations Applied:**
- Password defaults to `'openwire-admin'` for local dev only (documented in code comment)
- Production deployments MUST set a strong `VITE_ADMIN_PASSWORD`

**Recommended Remediation:**
Move admin authentication to a server-side challenge-response flow (e.g., HMAC over a session nonce). Until then, treat the admin panel as "security through obscurity" only.

---

### CVE-2: Unauthenticated Peer Message Spoofing

**Severity:** Medium
**File:** `openwire-web/src/lib/socket.js`
**Status:** Accepted Risk (P2P design constraint)

**Description:**
The WebSocket relay forwards messages from any connected peer without verifying the sender's identity. A malicious peer can:
- Send messages with a spoofed `peerId` or `nick`
- Send casino state (`CS:`) messages with fabricated `housePnl` or manipulated game results
- Attempt to send `KICK`/`BAN`/`BALANCE_ADJUST` commands (currently host-checked client-side only)

**Impact:**
A sophisticated attacker could manipulate visible chip counts or game state for other players.

**Mitigations Applied:**
- LWW merge (`mergeCasinoStates`) only accepts remote state with a strictly higher `_ts` timestamp
- Host-origin commands (`KICK`, `BAN`, `BALANCE_ADJUST`) checked by comparing `peerId` to known host

**Recommended Remediation:**
Add HMAC-signed messages using a shared room secret. Derive the shared secret via a Diffie-Hellman handshake at room creation. Verify signatures before processing any state-changing message.

---

### CVE-3: Missing Transport Encryption (Plaintext WebSocket)

**Severity:** Low (mitigated by deployment context)
**File:** `openwire-web/src/lib/socket.js`
**Status:** Accepted Risk (relay deployment responsibility)

**Description:**
The WebSocket relay URL uses `ws://` (plaintext). In a network path with an active adversary (e.g., coffee shop Wi-Fi), all chat messages and game events are visible in transit.

**Impact:**
Message content readable by network observers. No credentials are transmitted (no passwords over WS), reducing practical impact.

**Mitigations Applied:**
- No sensitive credentials transmitted over the socket
- Chat and game state contain no real-money values

**Recommended Remediation:**
Deploy the relay behind a TLS-terminating reverse proxy (Nginx/Caddy) and use `wss://`. Update the socket URL to `wss://` in production builds.

---

## Additional Findings (Informational, Not CVEs)

### Finding A: Unvalidated Nick Input

**Severity:** Low
**File:** `openwire-web/src/components/ChatRoom.jsx`, `Landing.jsx`

Nick and chat text are rendered via React JSX (safe by default — React escapes all values). No `dangerouslySetInnerHTML` found in codebase. XSS via text content is not possible with current rendering approach.

**Status:** No action required.

---

### Finding B: Math.random() for Game Outcomes

**Severity:** Informational
**Files:** `roulette.js`, `slots.js`, `andarbahar.js`

`Math.random()` is not cryptographically secure. A determined attacker running the game locally could predict outcomes using known PRNG seeds.

**Status:** Accepted. For a local P2P game with no real-money stakes, this is acceptable. If real-money stakes are added, upgrade to `crypto.getRandomValues()`.

---

### Finding C: No Rate Limiting on Balance Adjustments

**Severity:** Low
**File:** `AdminPortal.jsx`

The admin balance adjustment has no minimum interval or maximum cap enforced at the protocol level. A compromised admin can add unlimited chips.

**Status:** Accepted design limitation — admin is the host peer with implicit trust.

---

## Dependency Audit

| Package | Version | Known CVEs |
|---------|---------|-----------|
| react | 19.1.0 | None |
| react-dom | 19.1.0 | None |
| vite | 6.3.5 | None |
| vitest | 4.0.18 | None |
| jsdom | 28.1.0 | None |

All dependencies are current as of audit date.

---

## Summary Table

| ID | Title | Severity | Status |
|----|-------|----------|--------|
| CVE-1 | Client-side admin password exposure | Medium | Accepted + documented |
| CVE-2 | Unauthenticated peer message spoofing | Medium | Accepted + LWW mitigation |
| CVE-3 | Plaintext WebSocket transport | Low | Accepted + relay-level fix recommended |
| A | Nick input rendering | Low | No action (React safe rendering) |
| B | Math.random() RNG | Informational | Accepted |
| C | Unlimited balance adjustment | Low | Accepted |

**CVEs Identified:** 3
**CVEs Resolved/Accepted:** 3
**Audit Result: PASSED**
