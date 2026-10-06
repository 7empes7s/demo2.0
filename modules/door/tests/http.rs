//! The verifier HTTP service: request reading and limits, every answer of
//! `POST /presentations/verify`, and one real round trip over TCP.

use d2_door::http::{
    handle, load_keys, read_request, serve, verify_body, Request, Response, TimedRead, MAX_BODY,
    MAX_HEAD,
};
use d2_door::{
    Disclosure, Holder, IdentityProvider, Issuer, IssuerKey, IssuerSecret, MemoryStore,
    MockIdProvider, Presentation, UniquenessKey,
};
use rand::rngs::OsRng;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::time::{Duration, Instant};

const FROM: &str = "2026-01-01T00:00:00Z";
const TO: &str = "2026-12-31T23:59:59Z";
const CTX: &str = "agora:lu-commune-esch-sur-alzette";
const PATH: &str = "lu.lu-canton-esch-sur-alzette.lu-commune-esch-sur-alzette";
const WANTS: Disclosure = Disclosure {
    jurisdiction_levels: 3,
    adult: true,
    epoch: false,
};

/// A named edit to a good request, and the status and code it must give.
type Case = (&'static str, Box<dyn Fn(&mut Value)>, u16, &'static str);

struct World {
    keys: BTreeMap<u32, IssuerKey>,
    presentation: Presentation,
    minor: Presentation,
}

fn world() -> World {
    let mut provider = MockIdProvider::new();
    provider.add("alice", "test-person-0001", true, PATH);
    provider.add("carol", "test-person-0003", false, PATH);
    let mut door = Issuer::new(UniquenessKey::generate(&mut OsRng), MemoryStore::new());
    door.add_epoch(IssuerSecret::generate(1, FROM, TO, &mut OsRng))
        .unwrap();
    let key = door.issuer_key(1).unwrap().clone();
    let mut present = |token: &str| {
        let holder = Holder::new(&mut OsRng);
        let commit = holder.commit().unwrap();
        let assertion = provider.assert_identity(token).unwrap();
        let issuance = door
            .enrol(&assertion, 1, &commit.commitment, &mut OsRng)
            .unwrap();
        let credential = holder.finalize(&key, &issuance, &commit.blind).unwrap();
        credential.present(&key, CTX, b"nonce-1", &WANTS).unwrap()
    };
    let presentation = present("alice");
    let minor = present("carol");
    World {
        keys: BTreeMap::from([(1, key)]),
        presentation,
        minor,
    }
}

fn body(p: &Presentation) -> Value {
    json!({
        "presentation": p,
        "context": CTX,
        "challenge": hex::encode(b"nonce-1"),
        "epoch": 1,
        "require": {"jurisdiction_levels": 3, "adult": true},
    })
}

fn call(w: &World, b: &Value) -> (u16, Value) {
    let r = verify_body(&w.keys, &serde_json::to_vec(b).unwrap());
    (r.status, serde_json::from_str(&r.body).unwrap())
}

#[test]
fn verify_answers() {
    let w = world();
    let (status, ok) = call(&w, &body(&w.presentation));
    assert_eq!(status, 200, "{ok}");
    assert_eq!(ok["nym"], w.presentation.pseudonym.nym());
    assert_eq!(ok["pseudonym"], w.presentation.pseudonym.as_hex());
    assert_eq!(
        ok["disclosed"],
        json!({"jurisdiction_path": PATH, "adult": true})
    );
    assert_eq!(ok["epoch"], 1);

    // A minor's presentation verifies and says adult=false: the caller decides.
    let (status, minor) = call(&w, &body(&w.minor));
    assert_eq!(status, 200);
    assert_eq!(minor["disclosed"]["adult"], false);

    let cases: Vec<Case> = vec![
        (
            "other context",
            Box::new(|b| b["context"] = json!("agora:lu")),
            422,
            "context_mismatch",
        ),
        (
            "other challenge",
            Box::new(|b| b["challenge"] = json!(hex::encode(b"nonce-2"))),
            422,
            "challenge_mismatch",
        ),
        (
            "unknown epoch",
            Box::new(|b| b["epoch"] = json!(2)),
            422,
            "unknown_epoch",
        ),
        (
            "more levels required",
            Box::new(|b| b["require"]["jurisdiction_levels"] = json!(4)),
            422,
            "missing_disclosure",
        ),
        (
            "epoch required",
            Box::new(|b| b["require"]["epoch"] = json!(true)),
            422,
            "missing_disclosure",
        ),
        (
            "tampered adult",
            Box::new(|b| b["presentation"]["disclosed"]["adult"] = json!(false)),
            422,
            "invalid_proof",
        ),
        (
            "context edited to match",
            Box::new(|b| {
                b["context"] = json!("agora:lu");
                b["presentation"]["context"] = json!("agora:lu");
            }),
            422,
            "invalid_proof",
        ),
        (
            "short proof",
            Box::new(|b| b["presentation"]["proof"] = json!("00")),
            422,
            "malformed",
        ),
        (
            "bad pseudonym",
            Box::new(|b| b["presentation"]["pseudonym"] = json!("00")),
            400,
            "malformed",
        ),
        (
            "presentation not an object",
            Box::new(|b| b["presentation"] = json!("x")),
            400,
            "malformed",
        ),
        (
            "unknown field",
            Box::new(|b| b["nym"] = json!("nym-x")),
            400,
            "invalid_body",
        ),
        (
            "unknown require field",
            Box::new(|b| b["require"]["age"] = json!(18)),
            400,
            "invalid_body",
        ),
        (
            "missing epoch",
            Box::new(|b| {
                b.as_object_mut().unwrap().remove("epoch");
            }),
            400,
            "invalid_body",
        ),
        (
            "uppercase challenge",
            Box::new(|b| b["challenge"] = json!(hex::encode(b"nonce-1").to_uppercase())),
            400,
            "invalid_body",
        ),
        (
            "empty challenge",
            Box::new(|b| b["challenge"] = json!("")),
            400,
            "invalid_body",
        ),
        (
            "long challenge",
            Box::new(|b| b["challenge"] = json!("00".repeat(65))),
            400,
            "invalid_body",
        ),
        (
            "empty context",
            Box::new(|b| b["context"] = json!("")),
            400,
            "invalid_body",
        ),
        (
            "levels over 4",
            Box::new(|b| b["require"]["jurisdiction_levels"] = json!(5)),
            400,
            "invalid_body",
        ),
    ];
    for (name, edit, status, code) in cases {
        let mut b = body(&w.presentation);
        edit(&mut b);
        let (got, answer) = call(&w, &b);
        assert_eq!(
            (got, answer["code"].as_str().unwrap()),
            (status, code),
            "{name}: {answer}"
        );
    }
    let r = verify_body(&w.keys, b"not json");
    assert_eq!((r.status, r.body.contains("invalid_body")), (400, true));
}

fn req(raw: &[u8]) -> Result<Request, Response> {
    read_request(&mut &raw[..], Duration::from_secs(1))
}

#[test]
fn request_reading_and_limits() {
    let r = req(b"POST /presentations/verify?x=1 HTTP/1.1\r\ncontent-length: 2\r\n\r\n{}extra")
        .unwrap();
    assert_eq!(
        (r.method.as_str(), r.path.as_str(), &r.body[..]),
        ("POST", "/presentations/verify", &b"{}"[..])
    );
    let r = req(b"GET /healthz HTTP/1.0\r\n\r\n").unwrap();
    assert_eq!(r.body, b"");

    let status = |raw: &[u8]| req(raw).err().map(|r| r.status);
    assert_eq!(
        status(b"POST /presentations/verify HTTP/1.1\r\n\r\n"),
        Some(411)
    );
    let too_big = format!(
        "POST / HTTP/1.1\r\nContent-Length: {}\r\n\r\n",
        MAX_BODY + 1
    );
    assert_eq!(status(too_big.as_bytes()), Some(413));
    assert_eq!(
        status(b"POST / HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n"),
        Some(501)
    );
    assert_eq!(
        status(b"POST / HTTP/1.1\r\nContent-Length: 1\r\nContent-Length: 1\r\n\r\n{"),
        Some(400)
    );
    assert_eq!(
        status(b"POST / HTTP/1.1\r\nContent-Length: -1\r\n\r\n"),
        Some(400)
    );
    assert_eq!(
        status(b"POST / HTTP/1.1\r\nContent-Length: 99999999999\r\n\r\n"),
        Some(400)
    );
    assert_eq!(
        status(b"POST / HTTP/1.1\r\nContent-Length: 5\r\n\r\n{}"),
        Some(400)
    );
    assert_eq!(status(b"POST / HTTP/2\r\n\r\n"), Some(400));
    assert_eq!(status(b"POST  HTTP/1.1\r\n\r\n"), Some(400));
    assert_eq!(status(b"POST / HTTP/1.1\r\nno colon\r\n\r\n"), Some(400));
    assert_eq!(status(b"POST / HTTP/1.1\r\n"), Some(400));
    let big_head = format!("GET / HTTP/1.1\r\nX: {}\r\n\r\n", "a".repeat(MAX_HEAD));
    assert_eq!(status(big_head.as_bytes()), Some(431));

    // A bare LF anywhere in the head is refused; one in the body is just body.
    for raw in [
        &b"GET /healthz HTTP/1.1\n\n"[..],
        b"GET /healthz HTTP/1.1\r\nX: 1\n\r\n",
        b"\nGET /healthz HTTP/1.1\r\n\r\n",
    ] {
        assert_eq!(status(raw), Some(400), "{}", String::from_utf8_lossy(raw));
    }
    let r = req(b"POST / HTTP/1.1\r\nContent-Length: 3\r\n\r\n{\n}").unwrap();
    assert_eq!(r.body, b"{\n}");

    let keys = BTreeMap::new();
    let route = |m: &str, p: &str| {
        handle(
            &keys,
            &Request {
                method: m.into(),
                path: p.into(),
                body: vec![],
            },
        )
        .status
    };
    assert_eq!(route("GET", "/healthz"), 200);
    assert_eq!(route("GET", "/issuer-keys"), 200);
    assert_eq!(route("GET", "/presentations/verify"), 405);
    assert_eq!(route("POST", "/healthz"), 405);
    assert_eq!(route("GET", "/nope"), 404);
}

/// A reader that hands out one byte per read and records the timeouts it was given.
struct Drip<'a> {
    data: &'a [u8],
    delay: Duration,
}

impl Read for Drip<'_> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        std::thread::sleep(self.delay);
        match (self.data.split_first(), buf.first_mut()) {
            (Some((b, rest)), Some(slot)) => {
                *slot = *b;
                self.data = rest;
                Ok(1)
            }
            _ => Ok(0),
        }
    }
}

impl TimedRead for Drip<'_> {
    fn set_timeout(&mut self, _left: Duration) -> std::io::Result<()> {
        Ok(())
    }
}

#[test]
fn a_slow_client_gets_408_within_the_total_deadline() {
    let raw = b"POST /presentations/verify HTTP/1.1\r\nContent-Length: 2\r\n\r\n{}";
    let mut drip = Drip {
        data: raw,
        delay: Duration::from_millis(5),
    };
    let started = Instant::now();
    let r = read_request(&mut drip, Duration::from_millis(100)).unwrap_err();
    assert_eq!(r.status, 408);
    assert!(started.elapsed() < Duration::from_secs(1));
}

/// A reader that hands out its data once and then stalls (times out), like an idle client.
struct Stall<'a>(&'a [u8]);

impl Read for Stall<'_> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        if self.0.is_empty() {
            return Err(std::io::ErrorKind::TimedOut.into());
        }
        let n = self.0.len().min(buf.len());
        buf[..n].copy_from_slice(&self.0[..n]);
        self.0 = &self.0[n..];
        Ok(n)
    }
}

impl TimedRead for Stall<'_> {
    fn set_timeout(&mut self, _left: Duration) -> std::io::Result<()> {
        Ok(())
    }
}

#[test]
fn an_lf_only_head_is_refused_on_sight_not_after_the_timeout() {
    let r = read_request(
        &mut Stall(b"GET /healthz HTTP/1.1\n\n"),
        Duration::from_secs(5),
    );
    assert_eq!(r.unwrap_err().status, 400);
    let r = read_request(
        &mut Stall(b"GET /healthz HTTP/1.1\r\n"),
        Duration::from_secs(5),
    );
    assert_eq!(r.unwrap_err().status, 408);
}

#[test]
fn load_keys_refuses_bad_files() {
    let dir = std::env::temp_dir().join(format!("d2-door-keys-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let w = world();
    let key = w.keys[&1].clone();
    let good = dir.join("good.json");
    std::fs::write(&good, serde_json::to_string(&key).unwrap()).unwrap();
    let mut short = key.clone();
    short.bbs_public_key = "00".into();
    let bad = dir.join("bad.json");
    std::fs::write(&bad, serde_json::to_string(&short).unwrap()).unwrap();
    let s = |p: &std::path::Path| p.display().to_string();

    assert_eq!(load_keys(&[s(&good)]).unwrap().len(), 1);
    assert!(load_keys(&[]).is_err());
    assert!(load_keys(&[s(&bad)]).unwrap_err().contains("96 bytes"));
    assert!(load_keys(&[s(&good), s(&good)])
        .unwrap_err()
        .contains("same epoch"));
    assert!(load_keys(&[s(&dir.join("missing.json"))]).is_err());
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn round_trip_over_tcp_and_connection_cap() {
    let w = world();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let keys = w.keys.clone();
    std::thread::spawn(move || serve(listener, keys, Duration::from_millis(500), 1));

    let send = |raw: &[u8]| {
        let mut s = TcpStream::connect(addr).unwrap();
        s.write_all(raw).unwrap();
        let mut out = String::new();
        s.read_to_string(&mut out).unwrap();
        out
    };
    let b = serde_json::to_vec(&body(&w.presentation)).unwrap();
    let mut raw = format!(
        "POST /presentations/verify HTTP/1.1\r\nContent-Length: {}\r\n\r\n",
        b.len()
    )
    .into_bytes();
    raw.extend_from_slice(&b);
    let answer = send(&raw);
    assert!(answer.starts_with("HTTP/1.1 200 OK\r\n"), "{answer}");
    assert!(answer.contains(&w.presentation.pseudonym.nym()));
    assert!(answer.contains("Connection: close"));

    // One slot: a client that sends nothing holds it, the next one gets 503, and after the
    // first one's deadline (408) the service answers again. Wait for the first request's
    // handler to release its slot.
    std::thread::sleep(Duration::from_millis(300));
    let mut idle = TcpStream::connect(addr).unwrap();
    std::thread::sleep(Duration::from_millis(100));
    let mut busy = TcpStream::connect(addr).unwrap();
    let mut out = String::new();
    busy.read_to_string(&mut out).unwrap();
    assert!(out.starts_with("HTTP/1.1 503"), "{out}");
    out.clear();
    idle.read_to_string(&mut out).unwrap();
    assert!(out.starts_with("HTTP/1.1 408"), "{out}");
    drop(idle);
    // The handler drains the closed connection for at most 200 ms before freeing the slot.
    std::thread::sleep(Duration::from_millis(300));
    assert!(send(b"GET /healthz HTTP/1.1\r\n\r\n").starts_with("HTTP/1.1 200"));
}
