# PREFLIGHT architecture

PREFLIGHT is one deployable Node.js service with three deliberate layers:

```text
HTTP / Telegraph request
          |
          v
Telegraph adapter (request extraction + stable response formatting)
          |
          v
Canonical internal TLSVerificationResult
          |
          v
TLS engine (normalization -> deterministic DNS -> SSRF policy -> TLS)
```

The TLS engine does not import Telegraph code. The adapter does not perform
certificate validation. This keeps protocol experiments confined to
`src/telegraph/` and makes the validation core reusable by the later Agent
Gateway.

## TLS behavior

- `URL` performs URL/IDNA normalization; hostnames are lower-cased and one
  trailing dot is removed.
- DNS results are sorted by family (IPv4 before IPv6) and then address.
- Every resolved address is checked against the SSRF policy before any socket
  is opened. The TLS socket connects to that exact IP and sends the requested
  hostname as SNI.
- Native OpenSSL/Node certificate authorization is enabled in observation mode
  (`rejectUnauthorized: false`) so trust, hostname, and time failures can be
  classified independently. The result is still invalid unless all checks
  pass.
- `getPeerCertificate(true)` is walked through the server-presented issuer
  links. `chainComplete` means the leaf has a linked issuer in the presented
  chain; it is not inferred from trust or from an arbitrary chain length.
- A connection/handshake network failure tries the next deterministic address.
  If every address fails, the result from the attempt that progressed furthest
  (TLS handshake, then TCP connection, then connection failure) is retained;
  a later broken family cannot overwrite evidence that another family was
  reachable. A completed handshake is authoritative for that attempt, even if
  its certificate is invalid.
- TCP and TLS-handshake timers are separate phases. The TCP timer is cancelled
  on connect and only then is the handshake timer started, so a slow connect
  cannot expire under the wrong phase label.
- TLS 1.2 and TLS 1.3 are allowed; older protocols are not.

## Reliability boundaries

The HTTP layer returns 200 for a completed negative observation, 400 for
malformed input, and 500 only for unexpected internal failures. Every request
has a correlation ID and a structured log record. Shutdown stops accepting new
connections and closes the listener gracefully.
