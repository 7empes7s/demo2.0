//! The verifier as a small HTTP service, so modules in other languages (Agora is Python) can
//! check presentations without linking this crate. Standard library only: one thread per
//! connection, a fixed connection cap, every request answered and the connection closed.
//!
//! ```text
//! POST /presentations/verify  {presentation, context, challenge, epoch, require?}
//!                             -> 200 {pseudonym, nym, disclosed, epoch}
//!                             -> 422 {error, code}   code: one of VerifyError::code, or unknown_epoch
//!                             -> 400 {error, code}   code: invalid_body, malformed
//! GET  /issuer-keys           -> 200 {keys: [IssuerKey, ...]}
//! GET  /healthz               -> 200 {ok: true, epochs: [..]}
//! ```
//!
//! Limits: head 8 KiB (431), body 64 KiB (413), `Content-Length` required (411),
//! `Transfer-Encoding` refused (501), a line ending in a bare `\n` refused on sight (400), the
//! whole request within the timeout (408), at most `max_connections` at once (503). A client
//! that never finishes its head still holds a slot until the timeout, so `max_connections` such
//! clients delay everyone else for that long: serve on loopback only, behind the one caller. Nothing here panics on any input: [`read_request`] and
//! [`handle`] are pure enough to be swept with random bytes (`tests/no_panic.rs`).
//!
//! The verifier is told which epoch to check against (`epoch` in the request) instead of taking
//! it from the presentation, so the caller can accept exactly one epoch per context: a holder
//! with credentials for two epochs has two pseudonyms in each context.

use crate::attributes::{Disclosure, JURISDICTION_LEVELS};
use crate::holder::Presentation;
use crate::issuer::IssuerKey;
use crate::verifier::verify;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::io::{self, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

/// Largest request head (request line and headers) accepted.
pub const MAX_HEAD: usize = 8 * 1024;
/// Largest request body accepted. A presentation is about 1.5 KB of JSON.
pub const MAX_BODY: usize = 64 * 1024;
/// Time a client has to send its whole request.
pub const TIMEOUT: Duration = Duration::from_secs(5);
/// Connections handled at once; more get 503.
pub const MAX_CONNECTIONS: usize = 32;
/// Longest challenge accepted, in bytes.
pub const MAX_CHALLENGE: usize = 64;
/// Longest context accepted, in bytes.
pub const MAX_CONTEXT: usize = 256;

/// An HTTP answer: status and JSON body.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Response {
    /// HTTP status code.
    pub status: u16,
    /// JSON body.
    pub body: String,
}

impl Response {
    fn json(status: u16, value: &Value) -> Self {
        Response {
            status,
            body: value.to_string(),
        }
    }

    /// `{error, code}` with `status`.
    pub fn error(status: u16, code: &str, message: &str) -> Self {
        Self::json(status, &json!({ "error": message, "code": code }))
    }

    fn reason(&self) -> &'static str {
        match self.status {
            200 => "OK",
            400 => "Bad Request",
            404 => "Not Found",
            405 => "Method Not Allowed",
            408 => "Request Timeout",
            411 => "Length Required",
            413 => "Payload Too Large",
            422 => "Unprocessable Content",
            431 => "Request Header Fields Too Large",
            501 => "Not Implemented",
            503 => "Service Unavailable",
            _ => "Internal Server Error",
        }
    }

    /// The full HTTP/1.1 message, with `Connection: close`.
    pub fn to_bytes(&self) -> Vec<u8> {
        format!(
            "HTTP/1.1 {} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            self.status,
            self.reason(),
            self.body.len(),
            self.body
        )
        .into_bytes()
    }
}

/// A parsed request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Request {
    /// Method, e.g. `POST`.
    pub method: String,
    /// Path without the query string.
    pub path: String,
    /// The body, exactly `Content-Length` bytes.
    pub body: Vec<u8>,
}

/// A source the request is read from, with a way to bound each read by the time left.
pub trait TimedRead: Read {
    /// Limit the next read to `left`.
    fn set_timeout(&mut self, left: Duration) -> io::Result<()>;
}

impl TimedRead for TcpStream {
    fn set_timeout(&mut self, left: Duration) -> io::Result<()> {
        self.set_read_timeout(Some(left.max(Duration::from_millis(1))))
    }
}

impl TimedRead for &[u8] {
    fn set_timeout(&mut self, _left: Duration) -> io::Result<()> {
        Ok(())
    }
}

/// Read one request within `timeout` in total (not per read), so a client dripping one byte at
/// a time cannot hold a thread. Any failure is the response to send.
pub fn read_request<S: TimedRead>(stream: &mut S, timeout: Duration) -> Result<Request, Response> {
    let deadline = Instant::now() + timeout;
    let too_slow = || Response::error(408, "timeout", "request did not arrive in time");
    let mut buf: Vec<u8> = Vec::with_capacity(1024);
    let mut chunk = [0u8; 4096];

    // Head.
    let head_end = loop {
        let end = find(&buf, b"\r\n\r\n");
        if has_bare_lf(
            buf.get(..end.map_or(buf.len(), |i| i + 4))
                .unwrap_or_default(),
        ) {
            return Err(Response::error(
                400,
                "invalid_request",
                "lines must end in CRLF",
            ));
        }
        if let Some(i) = end {
            break i;
        }
        if buf.len() > MAX_HEAD {
            return Err(Response::error(
                431,
                "head_too_large",
                "request head too large",
            ));
        }
        let n = read_some(stream, &mut chunk, deadline).map_err(|_| too_slow())?;
        if n == 0 {
            return Err(Response::error(
                400,
                "invalid_request",
                "incomplete request",
            ));
        }
        buf.extend_from_slice(chunk.get(..n).unwrap_or_default());
    };
    if head_end > MAX_HEAD {
        return Err(Response::error(
            431,
            "head_too_large",
            "request head too large",
        ));
    }
    let head = std::str::from_utf8(buf.get(..head_end).unwrap_or_default())
        .map_err(|_| Response::error(400, "invalid_request", "request head is not UTF-8"))?;
    let mut lines = head.split("\r\n");
    let request_line = lines.next().unwrap_or_default();
    let mut parts = request_line.split(' ');
    let (method, target, version) = match (parts.next(), parts.next(), parts.next(), parts.next()) {
        (Some(m), Some(t), Some(v), None) if !m.is_empty() && t.starts_with('/') => (m, t, v),
        _ => return Err(Response::error(400, "invalid_request", "bad request line")),
    };
    if version != "HTTP/1.1" && version != "HTTP/1.0" {
        return Err(Response::error(
            400,
            "invalid_request",
            "unsupported HTTP version",
        ));
    }
    let mut content_length: Option<usize> = None;
    for line in lines {
        let (name, value) = line
            .split_once(':')
            .ok_or_else(|| Response::error(400, "invalid_request", "bad header line"))?;
        let value = value.trim();
        if name.eq_ignore_ascii_case("transfer-encoding") {
            return Err(Response::error(
                501,
                "not_implemented",
                "Transfer-Encoding is not supported; send Content-Length",
            ));
        }
        if name.eq_ignore_ascii_case("content-length") {
            if content_length.is_some() {
                return Err(Response::error(
                    400,
                    "invalid_request",
                    "repeated Content-Length",
                ));
            }
            if value.is_empty() || value.len() > 10 || !value.bytes().all(|b| b.is_ascii_digit()) {
                return Err(Response::error(
                    400,
                    "invalid_request",
                    "bad Content-Length",
                ));
            }
            content_length = Some(
                value
                    .parse()
                    .map_err(|_| Response::error(400, "invalid_request", "bad Content-Length"))?,
            );
        }
    }
    let path = target.split('?').next().unwrap_or_default().to_string();
    let method = method.to_string();

    // Body.
    let length = match content_length {
        Some(n) => n,
        None if method == "POST" => {
            return Err(Response::error(
                411,
                "length_required",
                "Content-Length is required",
            ))
        }
        None => 0,
    };
    if length > MAX_BODY {
        return Err(Response::error(
            413,
            "too_large",
            &format!("body is over {MAX_BODY} bytes"),
        ));
    }
    let mut body: Vec<u8> = buf.get(head_end + 4..).unwrap_or_default().to_vec();
    while body.len() < length {
        let n = read_some(stream, &mut chunk, deadline).map_err(|_| too_slow())?;
        if n == 0 {
            return Err(Response::error(
                400,
                "invalid_body",
                "body is shorter than Content-Length",
            ));
        }
        body.extend_from_slice(chunk.get(..n).unwrap_or_default());
    }
    body.truncate(length);
    Ok(Request { method, path, body })
}

fn read_some<S: TimedRead>(
    stream: &mut S,
    chunk: &mut [u8],
    deadline: Instant,
) -> io::Result<usize> {
    let left = deadline.saturating_duration_since(Instant::now());
    if left.is_zero() {
        return Err(io::ErrorKind::TimedOut.into());
    }
    stream.set_timeout(left)?;
    loop {
        match stream.read(chunk) {
            Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
            other => return other,
        }
    }
}

/// A `\n` not preceded by `\r`: an LF-only client would otherwise wait for the timeout.
fn has_bare_lf(head: &[u8]) -> bool {
    head.iter()
        .enumerate()
        .any(|(i, &b)| b == b'\n' && (i == 0 || head.get(i - 1) != Some(&b'\r')))
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

/// What the verifier needs: `{presentation, context, challenge, epoch, require?}`.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct VerifyRequest {
    presentation: Value,
    context: String,
    /// The challenge the caller issued, lowercase hex.
    challenge: String,
    /// The one epoch the caller accepts for this context.
    epoch: u32,
    #[serde(default)]
    require: Require,
}

#[derive(Deserialize, Default)]
#[serde(deny_unknown_fields)]
struct Require {
    #[serde(default)]
    jurisdiction_levels: usize,
    #[serde(default)]
    adult: bool,
    #[serde(default)]
    epoch: bool,
}

/// Answer one request. `keys` holds the issuer keys this verifier was started with, by epoch.
pub fn handle(keys: &BTreeMap<u32, IssuerKey>, request: &Request) -> Response {
    match (request.method.as_str(), request.path.as_str()) {
        ("GET", "/healthz") => Response::json(
            200,
            &json!({ "ok": true, "epochs": keys.keys().collect::<Vec<_>>() }),
        ),
        ("GET", "/issuer-keys") => {
            Response::json(200, &json!({ "keys": keys.values().collect::<Vec<_>>() }))
        }
        ("POST", "/presentations/verify") => verify_body(keys, &request.body),
        (_, "/healthz" | "/issuer-keys" | "/presentations/verify") => {
            Response::error(405, "method_not_allowed", "method not allowed")
        }
        _ => Response::error(404, "not_found", "not found"),
    }
}

/// The body of `POST /presentations/verify`.
pub fn verify_body(keys: &BTreeMap<u32, IssuerKey>, body: &[u8]) -> Response {
    let bad = |message: String| Response::error(400, "invalid_body", &message);
    let request: VerifyRequest = match serde_json::from_slice(body) {
        Ok(r) => r,
        Err(e) => {
            return bad(format!(
                "expected {{presentation, context, challenge, epoch, require?}}: {e}"
            ))
        }
    };
    if request.context.is_empty() || request.context.len() > MAX_CONTEXT {
        return bad(format!("context must be 1 to {MAX_CONTEXT} bytes"));
    }
    let challenge = match hex::decode(&request.challenge) {
        Ok(c)
            if !c.is_empty()
                && c.len() <= MAX_CHALLENGE
                && hex::encode(&c) == request.challenge =>
        {
            c
        }
        _ => {
            return bad(format!(
                "challenge must be 1 to {MAX_CHALLENGE} bytes of lowercase hex"
            ))
        }
    };
    if request.require.jurisdiction_levels > JURISDICTION_LEVELS {
        return bad(format!(
            "require.jurisdiction_levels must be 0 to {JURISDICTION_LEVELS}"
        ));
    }
    let presentation: Presentation = match serde_json::from_value(request.presentation) {
        Ok(p) => p,
        Err(e) => {
            return Response::error(400, "malformed", &format!("presentation: {e}"));
        }
    };
    let Some(key) = keys.get(&request.epoch) else {
        return Response::error(
            422,
            "unknown_epoch",
            &format!(
                "this verifier has no issuer key for epoch {}",
                request.epoch
            ),
        );
    };
    let required = Disclosure {
        jurisdiction_levels: request.require.jurisdiction_levels,
        adult: request.require.adult,
        epoch: request.require.epoch,
    };
    match verify(key, &presentation, &request.context, &challenge, &required) {
        Ok(v) => Response::json(
            200,
            &json!({
                "pseudonym": v.pseudonym.as_hex(),
                "nym": v.pseudonym.nym(),
                "disclosed": v.disclosed,
                "epoch": v.epoch,
            }),
        ),
        Err(e) => Response::error(422, e.code(), &e.to_string()),
    }
}

/// Load issuer keys from JSON files, one [`IssuerKey`] per file. Refuses a file that does not
/// decode to a usable key and a second key for the same epoch.
pub fn load_keys(paths: &[String]) -> Result<BTreeMap<u32, IssuerKey>, String> {
    let mut keys = BTreeMap::new();
    for path in paths {
        let text = std::fs::read_to_string(path).map_err(|e| format!("{path}: {e}"))?;
        let key: IssuerKey = serde_json::from_str(&text).map_err(|e| format!("{path}: {e}"))?;
        key.public_key().map_err(|e| format!("{path}: {e}"))?;
        if keys.insert(key.epoch, key).is_some() {
            return Err(format!("{path}: a second issuer key for the same epoch"));
        }
    }
    if keys.is_empty() {
        return Err("at least one --issuer-key is required".to_string());
    }
    Ok(keys)
}

/// Serve on `listener` until the process ends.
pub fn serve(
    listener: TcpListener,
    keys: BTreeMap<u32, IssuerKey>,
    timeout: Duration,
    max_connections: usize,
) {
    let keys = Arc::new(keys);
    let active = Arc::new(AtomicUsize::new(0));
    for stream in listener.incoming() {
        let Ok(mut stream) = stream else {
            // EMFILE, ENFILE, ENOMEM: do not spin at full CPU while they last.
            std::thread::sleep(Duration::from_millis(50));
            continue;
        };
        if active.fetch_add(1, Ordering::SeqCst) >= max_connections {
            active.fetch_sub(1, Ordering::SeqCst);
            // Answer without reading, from the accept loop: no blocking reads here.
            let _ = stream.set_nonblocking(true);
            finish(
                &mut stream,
                &Response::error(503, "busy", "too many connections"),
                Duration::ZERO,
            );
            continue;
        }
        let keys = Arc::clone(&keys);
        let slot = Slot(Arc::clone(&active));
        let spawned = std::thread::Builder::new().spawn(move || {
            let _slot = slot;
            let response = match read_request(&mut stream, timeout) {
                Ok(request) => handle(&keys, &request),
                Err(response) => response,
            };
            let _ = stream.set_write_timeout(Some(timeout));
            finish(&mut stream, &response, Duration::from_millis(200));
        });
        // If the thread could not start, its closure (and the slot) was dropped already.
        drop(spawned);
    }
}

/// Send `response`, close the writing side, then read and discard what the client still sends
/// (at most one request's worth, for at most `linger`), so closing does not reset the
/// connection before the client has read the answer.
fn finish(stream: &mut TcpStream, response: &Response, linger: Duration) {
    let _ = stream.write_all(&response.to_bytes());
    let _ = stream.flush();
    let _ = stream.shutdown(std::net::Shutdown::Write);
    if !linger.is_zero() {
        let _ = stream.set_read_timeout(Some(linger));
    }
    let deadline = Instant::now() + linger;
    let mut sink = [0u8; 4096];
    let mut left = MAX_HEAD + MAX_BODY;
    while left > 0 {
        match stream.read(&mut sink) {
            Ok(0) | Err(_) => break,
            Ok(n) => left = left.saturating_sub(n),
        }
        if Instant::now() >= deadline {
            break;
        }
    }
}

/// Releases a connection slot when the handler thread ends, however it ends.
struct Slot(Arc<AtomicUsize>);

impl Drop for Slot {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}
