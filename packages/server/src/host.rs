use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Duration,
};

use tokio::{
    io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader},
    sync::{mpsc, oneshot},
    time::timeout,
};
use uuid::Uuid;

const OPEN_PREFIX: &str = "MUSETRIC_PAGE_OPEN=";
const CLOSE_PREFIX: &str = "MUSETRIC_PAGE_CLOSE=";
const OPENED_PREFIX: &str = "MUSETRIC_PAGE_OPENED=";
const FAILED_PREFIX: &str = "MUSETRIC_PAGE_FAILED=";
const OPEN_TIMEOUT: Duration = Duration::from_mins(2);

pub(crate) enum PageFailure {
    Refused(String),
    Unreachable,
}

pub(crate) struct OpenedPage {
    page_id: String,
}

type PageAnswer = Result<(), String>;

pub(crate) struct HostProcess {
    lines: mpsc::UnboundedSender<String>,
    pending: Mutex<HashMap<String, oneshot::Sender<PageAnswer>>>,
    is_available: bool,
}

impl HostProcess {
    pub(crate) fn create<Input, Output>(
        input: Input,
        output: Output,
    ) -> (Arc<Self>, oneshot::Receiver<()>)
    where
        Input: AsyncRead + Unpin + Send + 'static,
        Output: AsyncWrite + Unpin + Send + 'static,
    {
        let (lines, written) = mpsc::unbounded_channel();
        let host = Arc::new(Self {
            lines,
            pending: Mutex::new(HashMap::new()),
            is_available: true,
        });
        let (closed, closing) = oneshot::channel();
        tokio::spawn(write_lines(output, written));
        tokio::spawn(read_lines(input, Arc::clone(&host), closed));
        (host, closing)
    }

    pub(crate) fn announce(&self, line: &str) {
        self.send(line);
    }

    pub(crate) fn unavailable() -> Arc<Self> {
        let (lines, _) = mpsc::unbounded_channel();
        Arc::new(Self {
            lines,
            pending: Mutex::new(HashMap::new()),
            is_available: false,
        })
    }

    pub(crate) async fn open_page(&self, url: &str) -> Result<OpenedPage, PageFailure> {
        if !self.is_available {
            return Err(PageFailure::Unreachable);
        }
        let page_id = Uuid::new_v4().to_string();
        let (sender, receiver) = oneshot::channel();
        self.remember(page_id.clone(), sender)?;
        self.send(&format!("{OPEN_PREFIX}{page_id} {url}"));
        let waited = timeout(OPEN_TIMEOUT, receiver).await;
        let Ok(answered) = waited else {
            self.forget(&page_id);
            self.send(&format!("{CLOSE_PREFIX}{page_id}"));
            return Err(PageFailure::Unreachable);
        };
        match answered {
            Ok(Ok(())) => Ok(OpenedPage { page_id }),
            Ok(Err(message)) => Err(PageFailure::Refused(message)),
            Err(_) => Err(PageFailure::Unreachable),
        }
    }

    pub(crate) fn close_page(&self, page: &OpenedPage) {
        self.send(&format!("{CLOSE_PREFIX}{}", page.page_id));
    }

    fn send(&self, line: &str) {
        let _ = self.lines.send(format!("{line}\n"));
    }

    fn remember(
        &self,
        page_id: String,
        sender: oneshot::Sender<PageAnswer>,
    ) -> Result<(), PageFailure> {
        self.pending
            .lock()
            .map_err(|_| PageFailure::Unreachable)?
            .insert(page_id, sender);
        Ok(())
    }

    fn forget(&self, page_id: &str) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.remove(page_id);
        }
    }

    fn accept(&self, line: &str) {
        if let Some(page_id) = line.strip_prefix(OPENED_PREFIX) {
            self.answer(page_id.trim(), Ok(()));
            return;
        }
        if let Some(answer) = line.strip_prefix(FAILED_PREFIX) {
            let (page_id, message) = answer.split_once(' ').unwrap_or((answer, ""));
            self.answer(page_id.trim(), Err(message.to_owned()));
        }
    }

    fn answer(&self, page_id: &str, answer: PageAnswer) {
        let taken = self
            .pending
            .lock()
            .ok()
            .and_then(|mut pending| pending.remove(page_id));
        if let Some(sender) = taken {
            let _ = sender.send(answer);
        }
    }

    fn disconnect(&self) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.clear();
        }
    }
}

async fn write_lines<Output>(mut output: Output, mut written: mpsc::UnboundedReceiver<String>)
where
    Output: AsyncWrite + Unpin + Send + 'static,
{
    while let Some(line) = written.recv().await {
        if output.write_all(line.as_bytes()).await.is_err() {
            return;
        }
        if output.flush().await.is_err() {
            return;
        }
    }
}

async fn read_lines<Input>(input: Input, host: Arc<HostProcess>, closed: oneshot::Sender<()>)
where
    Input: AsyncRead + Unpin + Send + 'static,
{
    let mut lines = BufReader::new(input).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        host.accept(&line);
    }
    host.disconnect();
    let _ = closed.send(());
}

#[cfg(test)]
pub(crate) mod tests {
    use std::sync::{Arc, Mutex};

    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, duplex, split};

    use super::{HostProcess, PageFailure};

    const URL: &str = "http://127.0.0.1:9/?jobs=x";
    const REFUSAL: &str = "the window could not be created";

    pub(crate) struct FakeHost {
        pub(crate) host: Arc<HostProcess>,
        pub(crate) asked: Arc<Mutex<Vec<String>>>,
    }

    pub(crate) fn start_fake_host(answer: Option<Result<(), &'static str>>) -> FakeHost {
        let (host_side, parent_side) = duplex(4096);
        let (host_input, host_output) = split(host_side);
        let (host, _) = HostProcess::create(host_input, host_output);
        let asked = Arc::new(Mutex::new(Vec::new()));
        tokio::spawn(answer_pages(parent_side, Arc::clone(&asked), answer));
        FakeHost { host, asked }
    }

    async fn answer_pages(
        parent_side: tokio::io::DuplexStream,
        asked: Arc<Mutex<Vec<String>>>,
        answer: Option<Result<(), &'static str>>,
    ) {
        let (input, mut output) = split(parent_side);
        let mut lines = BufReader::new(input).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let replied = read_reply(&line, answer);
            asked
                .lock()
                .expect("the asked lines should be writable")
                .push(line);
            let Some(reply) = replied else {
                continue;
            };
            if output.write_all(reply.as_bytes()).await.is_err() {
                return;
            }
        }
    }

    fn read_reply(line: &str, answer: Option<Result<(), &'static str>>) -> Option<String> {
        let asked = line.strip_prefix("MUSETRIC_PAGE_OPEN=")?;
        let page_id = asked.split_once(' ')?.0;
        match answer? {
            Ok(()) => Some(format!("MUSETRIC_PAGE_OPENED={page_id}\n")),
            Err(message) => Some(format!("MUSETRIC_PAGE_FAILED={page_id} {message}\n")),
        }
    }

    fn read_asked(fake: &FakeHost) -> Vec<String> {
        fake.asked
            .lock()
            .expect("the asked lines should be readable")
            .clone()
    }

    #[tokio::test]
    async fn asks_the_host_process_to_open_and_close_the_page() {
        let fake = start_fake_host(Some(Ok(())));

        let page = fake
            .host
            .open_page(URL)
            .await
            .map_err(|_| "the page should open")
            .expect("the page should open");
        fake.host.close_page(&page);
        tokio::task::yield_now().await;

        let asked = read_asked(&fake);
        let opened = asked.first().expect("the open line should be sent");
        let page_id = opened
            .strip_prefix("MUSETRIC_PAGE_OPEN=")
            .and_then(|line| line.split_once(' '))
            .expect("the open line should carry a page and a url");
        assert_eq!(page_id.1, URL);
        assert_eq!(
            asked.get(1),
            Some(&format!("MUSETRIC_PAGE_CLOSE={}", page_id.0))
        );
    }

    #[tokio::test]
    async fn fails_the_step_when_the_host_process_refuses() {
        let fake = start_fake_host(Some(Err(REFUSAL)));

        let refused = fake.host.open_page(URL).await;

        assert!(matches!(refused, Err(PageFailure::Refused(message)) if message == REFUSAL));
    }

    #[tokio::test]
    async fn reports_an_unreachable_host_process_when_it_stops() {
        let (host_side, parent_side) = duplex(4096);
        let (host_input, host_output) = split(host_side);
        let (host, closing) = HostProcess::create(host_input, host_output);

        let asking = tokio::spawn(async move { host.open_page(URL).await });
        tokio::task::yield_now().await;
        drop(parent_side);

        let refused = asking.await.expect("the request should finish");
        assert!(matches!(refused, Err(PageFailure::Unreachable)));
        assert!(closing.await.is_ok());
    }
}
