use std::{
    error::Error,
    io::{self, Write},
    net::{SocketAddr, TcpListener as StdTcpListener},
    path::PathBuf,
    time::Duration,
};

use axum::{
    Router,
    body::Body,
    extract::State,
    http::{HeaderMap, Request, StatusCode, Uri, Version, header::HOST},
    response::Response,
    routing::any,
};
use axum_server::{Handle, tls_rustls::RustlsConfig};
use hyper::upgrade;
use hyper_util::{
    client::legacy::{Client, connect::HttpConnector},
    rt::{TokioExecutor, TokioIo},
};
use tokio::{
    io::{AsyncReadExt, copy_bidirectional},
    net::TcpListener,
};

type ProxyClient = Client<HttpConnector, Body>;

const READY_PREFIX: &str = "MUSETRIC_PROXY_URL=";
const ADDRESS_IN_USE: &str = "MUSETRIC_PROXY_ERROR=address-in-use";
const SHUTDOWN_GRACE: Duration = Duration::from_secs(5);

#[derive(Clone)]
struct ProxyState {
    client: ProxyClient,
    upstream: Uri,
}

pub struct ServerOptions {
    pub upstream: String,
    pub listen: String,
    pub tls: Option<TlsOptions>,
}

pub struct TlsOptions {
    pub certificate: PathBuf,
    pub private_key: PathBuf,
}

pub async fn serve(options: ServerOptions) -> Result<(), Box<dyn Error>> {
    let app = create_router(options.upstream.parse()?);
    let socket = bind(&options.listen)?;
    let address = socket.local_addr()?;
    if let Some(tls) = options.tls {
        let config = RustlsConfig::from_pem_file(tls.certificate, tls.private_key).await?;
        let handle = Handle::<SocketAddr>::new();
        tokio::spawn(shutdown_on_closed_stdin(handle.clone()));
        print_ready("https", address)?;
        axum_server::from_tcp_rustls(socket, config)?
            .handle(handle)
            .serve(app.into_make_service())
            .await?;
        return Ok(());
    }
    let listener = TcpListener::from_std(socket)?;
    print_ready("http", address)?;
    axum::serve(listener, app)
        .with_graceful_shutdown(closed_stdin())
        .await?;
    Ok(())
}

fn bind(listen: &str) -> Result<StdTcpListener, Box<dyn Error>> {
    let listener = StdTcpListener::bind(listen).map_err(report_bind_failure)?;
    listener.set_nonblocking(true)?;
    Ok(listener)
}

fn report_bind_failure(error: io::Error) -> io::Error {
    if error.kind() == io::ErrorKind::AddrInUse {
        let _ = writeln!(io::stderr().lock(), "{ADDRESS_IN_USE}");
    }
    error
}

fn print_ready(protocol: &str, address: SocketAddr) -> io::Result<()> {
    let mut stdout = io::stdout().lock();
    writeln!(stdout, "{READY_PREFIX}{protocol}://{address}")?;
    stdout.flush()
}

async fn closed_stdin() {
    let mut stdin = tokio::io::stdin();
    let mut buffer = [0_u8; 256];
    while let Ok(read) = stdin.read(&mut buffer).await {
        if read == 0 {
            return;
        }
    }
}

async fn shutdown_on_closed_stdin(handle: Handle<SocketAddr>) {
    closed_stdin().await;
    handle.graceful_shutdown(Some(SHUTDOWN_GRACE));
}

fn create_router(upstream: Uri) -> Router {
    let connector = HttpConnector::new();
    let client = Client::builder(TokioExecutor::new()).build(connector);
    Router::new()
        .fallback(any(forward))
        .with_state(ProxyState { client, upstream })
}

async fn forward(State(state): State<ProxyState>, mut request: Request<Body>) -> Response<Body> {
    let uri = match create_upstream_uri(&state.upstream, request.uri()) {
        Ok(uri) => uri,
        Err(error) => return proxy_error(error),
    };
    let upgrade_requested = is_upgrade_request(request.headers());
    *request.uri_mut() = uri;
    *request.version_mut() = Version::HTTP_11;
    request.headers_mut().remove(HOST);

    let pending_downstream_upgrade = upgrade_requested.then(|| upgrade::on(&mut request));
    let mut response = match state.client.request(request).await {
        Ok(response) => response,
        Err(error) => return proxy_error(error),
    };

    if response.status() == StatusCode::SWITCHING_PROTOCOLS
        && let Some(downstream_upgrade) = pending_downstream_upgrade
    {
        let upstream_upgrade = upgrade::on(&mut response);
        tokio::spawn(async move {
            let Ok(downstream_connection) = downstream_upgrade.await else {
                return;
            };
            let Ok(upstream_connection) = upstream_upgrade.await else {
                return;
            };
            let mut downstream_io = TokioIo::new(downstream_connection);
            let mut upstream_io = TokioIo::new(upstream_connection);
            let _ = copy_bidirectional(&mut downstream_io, &mut upstream_io).await;
        });
    }

    response.map(Body::new)
}

fn create_upstream_uri(upstream: &Uri, request: &Uri) -> Result<Uri, &'static str> {
    let scheme = upstream.scheme_str().ok_or("upstream has no scheme")?;
    if scheme != "http" {
        return Err("upstream must use HTTP");
    }
    let authority = upstream
        .authority()
        .ok_or("upstream has no authority")?
        .as_str();
    let path_and_query = request.path_and_query().map_or("/", |value| value.as_str());
    Uri::builder()
        .scheme(scheme)
        .authority(authority)
        .path_and_query(path_and_query)
        .build()
        .map_err(|_| "could not create upstream request URI")
}

fn is_upgrade_request(headers: &HeaderMap) -> bool {
    headers.get("upgrade").is_some()
        && headers
            .get("connection")
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| {
                value
                    .split(',')
                    .any(|token| token.trim().eq_ignore_ascii_case("upgrade"))
            })
}

fn proxy_error(error: impl std::fmt::Display) -> Response<Body> {
    let mut response = Response::new(Body::from(format!("Failed to reach the upstream: {error}")));
    *response.status_mut() = StatusCode::BAD_GATEWAY;
    response
}

#[cfg(test)]
mod tests {
    use std::{
        net::SocketAddr,
        time::{Duration, Instant},
    };

    use axum::{
        Router,
        body::Body,
        http::{HeaderValue, Request, Response, Version},
        routing::any,
    };
    use http_body_util::BodyExt;
    use hyper::{StatusCode, upgrade};
    use hyper_util::rt::TokioIo;
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::{TcpListener, TcpStream},
        sync::oneshot,
        time::sleep,
    };
    use tower::ServiceExt;

    use super::create_router;

    const CHUNK_DELAY: Duration = Duration::from_millis(400);

    async fn start_server(app: Router) -> (SocketAddr, oneshot::Sender<()>) {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("test server should bind");
        let address = listener
            .local_addr()
            .expect("test server should have a local address");
        let (shutdown_sender, shutdown_receiver) = oneshot::channel();
        tokio::spawn(async move {
            axum::serve(listener, app)
                .with_graceful_shutdown(async {
                    let _ = shutdown_receiver.await;
                })
                .await
                .expect("test server should stop cleanly");
        });
        (address, shutdown_sender)
    }

    async fn start_proxy_for(upstream: SocketAddr) -> (SocketAddr, oneshot::Sender<()>) {
        start_server(create_router(
            format!("http://{upstream}")
                .parse()
                .expect("upstream address should be a valid uri"),
        ))
        .await
    }

    async fn echo_upgrade(upgrade: upgrade::OnUpgrade) {
        let upgraded = upgrade.await.expect("upstream should upgrade");
        let mut connection = TokioIo::new(upgraded);
        let mut message = [0; 4];
        connection
            .read_exact(&mut message)
            .await
            .expect("upstream should receive a message");
        connection
            .write_all(&message)
            .await
            .expect("upstream should echo a message");
    }

    async fn read_until(connection: &mut TcpStream, marker: &str) -> String {
        let mut received = Vec::new();
        while !String::from_utf8_lossy(&received).contains(marker) {
            let byte = connection
                .read_u8()
                .await
                .expect("response should be readable");
            received.push(byte);
        }
        String::from_utf8(received).expect("response should be valid text")
    }

    #[tokio::test]
    async fn proxies_the_method_query_headers_and_body() {
        let upstream = Router::new().fallback(any(|request: Request<Body>| async move {
            let (parts, request_body) = request.into_parts();
            let payload = request_body
                .collect()
                .await
                .expect("request body should be readable")
                .to_bytes();
            let response = format!(
                "{} {} {} {}",
                parts.method,
                parts.uri,
                parts
                    .headers
                    .get("x-proxy-test")
                    .expect("header should be forwarded")
                    .to_str()
                    .expect("header should be valid text"),
                String::from_utf8(payload.to_vec()).expect("body should be valid text"),
            );
            Response::builder()
                .header("x-upstream-response", HeaderValue::from_static("present"))
                .body(Body::from(response))
                .expect("response should be valid")
        }));
        let (upstream_address, upstream_shutdown) = start_server(upstream).await;
        let (proxy_address, proxy_shutdown) = start_proxy_for(upstream_address).await;

        let mut connection = TcpStream::connect(proxy_address)
            .await
            .expect("proxy should accept connections");
        connection
            .write_all(
                b"POST /project?id=1 HTTP/1.1\r\nHost: localhost\r\nX-Proxy-Test: forwarded\r\nContent-Length: 7\r\nConnection: close\r\n\r\npayload",
            )
            .await
            .expect("request should be written");
        let mut response = String::new();
        connection
            .read_to_string(&mut response)
            .await
            .expect("response should be read");

        assert!(response.starts_with("HTTP/1.1 200 OK"));
        assert!(response.contains("x-upstream-response: present"));
        assert!(response.ends_with("POST /project?id=1 forwarded payload"));

        proxy_shutdown
            .send(())
            .expect("proxy should still be running");
        upstream_shutdown
            .send(())
            .expect("upstream should still be running");
    }

    #[test]
    fn keeps_the_request_path_and_query_when_building_the_upstream_uri() {
        let upstream = "http://127.0.0.1:3000"
            .parse()
            .expect("upstream should be a valid uri");
        let request = "/api/project/list?sort=name"
            .parse()
            .expect("request should be a valid uri");
        let uri =
            super::create_upstream_uri(&upstream, &request).expect("upstream uri should be built");

        assert_eq!(uri, "http://127.0.0.1:3000/api/project/list?sort=name");
    }

    #[tokio::test]
    async fn sends_http_one_upstream_when_the_browser_speaks_http_two() {
        let upstream = Router::new().fallback(any(|request: Request<Body>| async move {
            format!("{:?}", request.version())
        }));
        let (upstream_address, upstream_shutdown) = start_server(upstream).await;
        let proxy = create_router(
            format!("http://{upstream_address}")
                .parse()
                .expect("upstream address should be a valid uri"),
        );

        let request = Request::builder()
            .version(Version::HTTP_2)
            .uri("/api/project/list")
            .body(Body::empty())
            .expect("request should be valid");
        let response = proxy
            .oneshot(request)
            .await
            .expect("proxy should answer an http two request");

        assert_eq!(response.status(), StatusCode::OK);
        let body = response
            .into_body()
            .collect()
            .await
            .expect("response body should be readable")
            .to_bytes();
        assert_eq!(&body[..], b"HTTP/1.1");

        upstream_shutdown
            .send(())
            .expect("upstream should still be running");
    }

    #[tokio::test]
    async fn passes_chunks_on_while_the_upstream_is_still_writing() {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("upstream should bind");
        let upstream_address = listener
            .local_addr()
            .expect("upstream should have a local address");
        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.expect("upstream should accept");
            let mut request = [0_u8; 1024];
            let read = stream
                .read(&mut request)
                .await
                .expect("upstream should read the request");
            assert!(read > 0, "upstream should receive a request");
            stream
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nfirst\r\n",
                )
                .await
                .expect("upstream should write the first chunk");
            sleep(CHUNK_DELAY).await;
            stream
                .write_all(b"6\r\nsecond\r\n0\r\n\r\n")
                .await
                .expect("upstream should write the last chunk");
        });
        let (proxy_address, proxy_shutdown) = start_proxy_for(upstream_address).await;

        let started = Instant::now();
        let mut connection = TcpStream::connect(proxy_address)
            .await
            .expect("proxy should accept connections");
        connection
            .write_all(b"GET /api/project/status/stream HTTP/1.1\r\nHost: localhost\r\n\r\n")
            .await
            .expect("request should be written");

        let head = read_until(&mut connection, "first").await;
        let first_chunk_delay = started.elapsed();
        assert!(head.contains("content-type: text/event-stream"));
        assert!(
            first_chunk_delay < CHUNK_DELAY,
            "the first chunk waited {first_chunk_delay:?} for the stream to end"
        );

        read_until(&mut connection, "second").await;

        proxy_shutdown
            .send(())
            .expect("proxy should still be running");
    }

    #[tokio::test]
    async fn answers_bad_gateway_when_the_upstream_is_unreachable() {
        let closed = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("port should bind");
        let closed_address = closed.local_addr().expect("port should have an address");
        drop(closed);
        let (proxy_address, proxy_shutdown) = start_proxy_for(closed_address).await;

        let mut connection = TcpStream::connect(proxy_address)
            .await
            .expect("proxy should accept connections");
        connection
            .write_all(
                b"GET /api/project/list HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
            )
            .await
            .expect("request should be written");
        let mut response = String::new();
        connection
            .read_to_string(&mut response)
            .await
            .expect("response should be read");

        assert!(response.starts_with("HTTP/1.1 502 Bad Gateway"));

        proxy_shutdown
            .send(())
            .expect("proxy should still be running");
    }

    #[tokio::test]
    async fn tunnels_http_upgrades() {
        let upstream = Router::new().fallback(any(|mut request: Request<Body>| async move {
            let upgrade = upgrade::on(&mut request);
            tokio::spawn(echo_upgrade(upgrade));
            Response::builder()
                .status(StatusCode::SWITCHING_PROTOCOLS)
                .header("connection", "upgrade")
                .header("upgrade", "echo")
                .body(Body::empty())
                .expect("upgrade response should be valid")
        }));
        let (upstream_address, upstream_shutdown) = start_server(upstream).await;
        let (proxy_address, proxy_shutdown) = start_proxy_for(upstream_address).await;

        let mut connection = TcpStream::connect(proxy_address)
            .await
            .expect("proxy should accept connections");
        connection
            .write_all(
                b"GET /realtime HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: echo\r\n\r\n",
            )
            .await
            .expect("upgrade request should be written");

        let head = read_until(&mut connection, "\r\n\r\n").await;
        assert!(head.starts_with("HTTP/1.1 101 Switching Protocols"));

        connection
            .write_all(b"ping")
            .await
            .expect("tunnel message should be written");
        let mut response = [0; 4];
        connection
            .read_exact(&mut response)
            .await
            .expect("tunnel message should be read");
        assert_eq!(&response, b"ping");

        proxy_shutdown
            .send(())
            .expect("proxy should still be running");
        upstream_shutdown
            .send(())
            .expect("upstream should still be running");
    }
}
