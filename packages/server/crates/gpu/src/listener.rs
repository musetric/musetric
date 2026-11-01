use std::{io, net::SocketAddr, time::Duration};

use axum::serve::Listener;
use tokio::{
    net::{TcpListener, TcpStream},
    sync::{mpsc, oneshot},
    time::{sleep, timeout},
};

const ACCEPT_RETRY: Duration = Duration::from_secs(1);
const PROBE_LIMIT: Duration = Duration::from_secs(1);
const STOPPED: &str = "the listener has stopped";

type Rebind = oneshot::Sender<io::Result<()>>;

pub struct RevivingListener {
    address: SocketAddr,
    listener: Option<TcpListener>,
    rebinds: mpsc::UnboundedReceiver<Rebind>,
}

#[derive(Clone)]
pub struct ListenerReviver {
    address: SocketAddr,
    rebinds: mpsc::UnboundedSender<Rebind>,
}

enum Event {
    Accepted(io::Result<(TcpStream, SocketAddr)>),
    Rebind(Rebind),
}

impl RevivingListener {
    pub fn wrap(listener: TcpListener) -> io::Result<(Self, ListenerReviver)> {
        let address = listener.local_addr()?;
        let (sender, receiver) = mpsc::unbounded_channel();
        Ok((
            Self {
                address,
                listener: Some(listener),
                rebinds: receiver,
            },
            ListenerReviver {
                address,
                rebinds: sender,
            },
        ))
    }

    async fn next_event(&mut self) -> Event {
        let listener = self.listener.as_ref();
        let rebinds = &mut self.rebinds;
        tokio::select! {
            accepted = accept_on(listener) => Event::Accepted(accepted),
            Some(done) = rebinds.recv() => Event::Rebind(done),
        }
    }

    async fn rebind(&mut self, done: Rebind) {
        self.listener = None;
        match TcpListener::bind(self.address).await {
            Ok(listener) => {
                self.listener = Some(listener);
                let _ = done.send(Ok(()));
            }
            Err(error) => {
                let _ = done.send(Err(error));
            }
        }
    }
}

impl Listener for RevivingListener {
    type Io = TcpStream;
    type Addr = SocketAddr;

    async fn accept(&mut self) -> (TcpStream, SocketAddr) {
        loop {
            match self.next_event().await {
                Event::Accepted(Ok(connection)) => return connection,
                Event::Accepted(Err(error)) if is_connection_error(&error) => {}
                Event::Accepted(Err(_)) => sleep(ACCEPT_RETRY).await,
                Event::Rebind(done) => self.rebind(done).await,
            }
        }
    }

    fn local_addr(&self) -> io::Result<SocketAddr> {
        Ok(self.address)
    }
}

impl ListenerReviver {
    pub async fn revive(&self) -> io::Result<()> {
        if self.responds().await {
            return Ok(());
        }
        self.rebind().await
    }

    async fn responds(&self) -> bool {
        matches!(
            timeout(PROBE_LIMIT, TcpStream::connect(self.address)).await,
            Ok(Ok(_))
        )
    }

    async fn rebind(&self) -> io::Result<()> {
        let (done, rebound) = oneshot::channel();
        self.rebinds
            .send(done)
            .map_err(|_| io::Error::other(STOPPED))?;
        rebound.await.map_err(|_| io::Error::other(STOPPED))?
    }
}

async fn accept_on(listener: Option<&TcpListener>) -> io::Result<(TcpStream, SocketAddr)> {
    match listener {
        Some(bound) => bound.accept().await,
        None => std::future::pending().await,
    }
}

fn is_connection_error(error: &io::Error) -> bool {
    matches!(
        error.kind(),
        io::ErrorKind::ConnectionRefused
            | io::ErrorKind::ConnectionAborted
            | io::ErrorKind::ConnectionReset
    )
}

#[cfg(test)]
mod tests {
    use axum::{Router, routing::get};
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::{TcpListener, TcpStream},
    };

    use super::{ListenerReviver, RevivingListener};

    async fn start() -> ListenerReviver {
        let bound = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("the test listener should bind");
        let (listener, reviver) = RevivingListener::wrap(bound).expect("the listener should wrap");
        let application = Router::new().route("/", get(|| async { "served" }));
        tokio::spawn(async move {
            let _ = axum::serve(listener, application).await;
        });
        reviver
    }

    async fn fetch(reviver: &ListenerReviver) -> String {
        let mut stream = TcpStream::connect(reviver.address)
            .await
            .expect("the server should accept");
        stream
            .write_all(b"GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
            .await
            .expect("the request should be written");
        let mut response = String::new();
        stream
            .read_to_string(&mut response)
            .await
            .expect("the response should be read");
        response
    }

    #[tokio::test]
    async fn revive_keeps_a_listener_that_accepts() {
        let reviver = start().await;
        reviver.revive().await.expect("revive should succeed");
        assert!(fetch(&reviver).await.ends_with("served"));
    }

    #[tokio::test]
    async fn rebind_serves_again_on_the_same_address() {
        let reviver = start().await;
        reviver.rebind().await.expect("rebind should succeed");
        reviver
            .rebind()
            .await
            .expect("a second rebind should succeed");
        assert!(fetch(&reviver).await.ends_with("served"));
    }
}
