use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Duration,
};

use serde_json::{Value, json};
use tokio::{
    sync::{mpsc, oneshot},
    time::timeout,
};

use crate::pages::{OpenedPage, OpeningPage, PageFailure, PageOpener};

const OPEN_TIMEOUT: Duration = Duration::from_mins(2);
const OPEN_TYPE: &str = "open";
const CLOSE_TYPE: &str = "close";
const OPENED_TYPE: &str = "opened";
const FAILED_TYPE: &str = "failed";

type PageAnswer = Result<(), String>;
type Outgoing = mpsc::UnboundedSender<String>;

pub(crate) struct PageBridge {
    pages: Mutex<Vec<Outgoing>>,
    pending: Mutex<HashMap<String, oneshot::Sender<PageAnswer>>>,
}

impl PageBridge {
    pub(crate) fn create() -> Arc<Self> {
        Arc::new(Self {
            pages: Mutex::new(Vec::new()),
            pending: Mutex::new(HashMap::new()),
        })
    }

    pub(crate) fn attach(&self, outgoing: Outgoing) {
        if let Ok(mut pages) = self.pages.lock() {
            pages.push(outgoing);
        }
    }

    pub(crate) fn detach(&self, outgoing: &Outgoing) {
        if let Ok(mut pages) = self.pages.lock() {
            pages.retain(|candidate| !candidate.same_channel(outgoing));
        }
        self.break_pending();
    }

    pub(crate) fn accept(&self, text: &str) {
        let Ok(value) = serde_json::from_str::<Value>(text) else {
            return;
        };
        let Value::String(page_id) = value.get("id").unwrap_or(&Value::Null) else {
            return;
        };
        match value.get("type").and_then(Value::as_str) {
            Some(OPENED_TYPE) => self.answer(page_id, Ok(())),
            Some(FAILED_TYPE) => {
                let message = value
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                self.answer(page_id, Err(message.to_owned()));
            }
            _ => {}
        }
    }

    fn break_pending(&self) {
        let taken = self
            .pending
            .lock()
            .ok()
            .map(|mut pending| pending.drain().collect::<Vec<_>>());
        drop(taken);
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

    fn send(&self, line: String) -> bool {
        let pages = self.pages.lock().ok();
        let Some(first) = pages.as_ref().and_then(|connected| connected.first()) else {
            return false;
        };
        first.send(line).is_ok()
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

    async fn request_page(&self, url: &str) -> Result<OpenedPage, PageFailure> {
        let page_id = uuid::Uuid::new_v4().to_string();
        let (sender, receiver) = oneshot::channel();
        self.remember(page_id.clone(), sender)?;
        let request = json!({
            "type": OPEN_TYPE,
            "id": page_id,
            "url": url,
        });
        if !self.send(request.to_string()) {
            self.forget(&page_id);
            return Err(PageFailure::Unreachable);
        }
        let waited = timeout(OPEN_TIMEOUT, receiver).await;
        let Ok(answered) = waited else {
            self.forget(&page_id);
            self.close(&page_id);
            return Err(PageFailure::Unreachable);
        };
        match answered {
            Ok(Ok(())) => Ok(OpenedPage::create(page_id)),
            Ok(Err(message)) => Err(PageFailure::Refused(message)),
            Err(_) => Err(PageFailure::Unreachable),
        }
    }

    fn close(&self, page_id: &str) {
        let close = json!({
            "type": CLOSE_TYPE,
            "id": page_id,
        });
        self.send(close.to_string());
    }
}

impl PageOpener for PageBridge {
    fn open_page<'opener>(&'opener self, url: &'opener str) -> OpeningPage<'opener> {
        Box::pin(self.request_page(url))
    }

    fn close_page(&self, page: &OpenedPage) {
        self.close(page.id());
    }
}

#[cfg(test)]
mod tests {
    use std::{sync::Arc, time::Duration};

    use serde_json::{Value, json};
    use tokio::{sync::mpsc, time::timeout};

    use super::PageBridge;
    use crate::pages::{PageFailure, PageOpener};

    const URL: &str = "http://127.0.0.1:9/?jobs=x";
    const REFUSAL: &str = "the frame could not be created";
    const WAIT: Duration = Duration::from_secs(1);

    struct FakePage {
        incoming: mpsc::UnboundedReceiver<String>,
        channel: mpsc::UnboundedSender<String>,
    }

    fn attach_fake_page(bridge: &PageBridge) -> FakePage {
        let (channel, incoming) = mpsc::unbounded_channel();
        bridge.attach(channel.clone());
        FakePage { incoming, channel }
    }

    async fn next_line(page: &mut FakePage) -> String {
        timeout(WAIT, page.incoming.recv())
            .await
            .expect("the line should arrive in time")
            .expect("the channel should stay open")
    }

    fn page_id_of(line: &str) -> String {
        serde_json::from_str::<Value>(line).expect("the line should be json")["id"]
            .as_str()
            .expect("the line should carry an id")
            .to_owned()
    }

    fn reply(bridge: &PageBridge, page_id: &str, kind: &str, extra: &str) {
        let line = format!(r#"{{"type":"{kind}","id":"{page_id}"{extra}}}"#);
        bridge.accept(&line);
    }

    fn spawn_open(
        bridge: &Arc<PageBridge>,
    ) -> tokio::task::JoinHandle<Result<crate::pages::OpenedPage, PageFailure>> {
        let task_bridge = Arc::clone(bridge);
        tokio::spawn(async move { task_bridge.open_page(URL).await })
    }

    #[tokio::test]
    async fn refuses_to_open_pages_with_no_app_page_connected() {
        let bridge = PageBridge::create();

        let refused = bridge.open_page(URL).await;

        assert!(matches!(refused, Err(PageFailure::Unreachable)));
    }

    #[tokio::test]
    async fn asks_the_app_page_to_open_and_close_the_frame() {
        let bridge = PageBridge::create();
        let mut page = attach_fake_page(&bridge);
        let asking = { spawn_open(&bridge) };
        let opened = next_line(&mut page).await;
        let page_id = page_id_of(&opened);
        reply(&bridge, &page_id, "opened", "");

        let opened_page = asking
            .await
            .expect("the request should finish")
            .expect("the page should open");
        bridge.close_page(&opened_page);
        let closed = next_line(&mut page).await;

        assert_eq!(
            serde_json::from_str::<Value>(&opened).expect("the open should be json"),
            json!({"type": "open", "id": page_id, "url": URL})
        );
        assert_eq!(
            serde_json::from_str::<Value>(&closed).expect("the close should be json"),
            json!({"type": "close", "id": page_id})
        );
    }

    #[tokio::test]
    async fn refuses_the_page_when_the_app_page_reports_a_failure() {
        let bridge = PageBridge::create();
        let mut page = attach_fake_page(&bridge);
        let asking = { spawn_open(&bridge) };
        let opened = next_line(&mut page).await;
        let page_id = page_id_of(&opened);
        reply(
            &bridge,
            &page_id,
            "failed",
            &format!(r#","message":"{REFUSAL}""#),
        );

        let refused = asking.await.expect("the request should finish");

        assert!(matches!(refused, Err(PageFailure::Refused(message)) if message == REFUSAL));
    }

    #[tokio::test]
    async fn leaves_the_open_unreachable_when_the_app_page_disconnects() {
        let bridge = PageBridge::create();
        let mut page = attach_fake_page(&bridge);
        let asking = { spawn_open(&bridge) };
        next_line(&mut page).await;

        bridge.detach(&page.channel);
        drop(page);
        let refused = asking.await.expect("the request should finish");

        assert!(matches!(refused, Err(PageFailure::Unreachable)));
    }

    #[tokio::test]
    async fn ignores_replies_for_unknown_pages() {
        let bridge = PageBridge::create();
        let mut page = attach_fake_page(&bridge);
        let asking = { spawn_open(&bridge) };
        let opened = next_line(&mut page).await;
        let page_id = page_id_of(&opened);

        reply(&bridge, "unknown", "opened", "");
        reply(&bridge, &page_id, "opened", "");

        let answered = asking.await.expect("the request should finish");
        assert!(answered.is_ok());
    }
}
