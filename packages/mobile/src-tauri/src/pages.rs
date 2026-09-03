use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Duration,
};

use musetric_server::{OpenedPage, OpeningPage, PageFailure, PageOpener};
use tauri::{AppHandle, Emitter, State};
use tokio::{sync::oneshot, time::timeout};

const OPEN_EVENT: &str = "musetric://open-page";
const CLOSE_EVENT: &str = "musetric://close-page";
const OPEN_TIMEOUT: Duration = Duration::from_mins(2);
const POISONED: &str = "the page opener is poisoned";

type PageAnswer = Result<(), String>;

pub(crate) struct TauriPages {
    app: AppHandle,
    next_page: Mutex<u64>,
    pending: Mutex<HashMap<String, oneshot::Sender<PageAnswer>>>,
}

impl TauriPages {
    #[must_use]
    pub(crate) fn create(app: AppHandle) -> Arc<Self> {
        Arc::new(Self {
            app,
            next_page: Mutex::new(0),
            pending: Mutex::new(HashMap::new()),
        })
    }

    pub(crate) fn report(&self, page_id: &str, error: Option<String>) {
        let taken = self
            .pending
            .lock()
            .ok()
            .and_then(|mut pending| pending.remove(page_id));
        if let Some(sender) = taken {
            let _ = sender.send(error.map_or(Ok(()), Err));
        }
    }

    fn take_page_id(&self) -> Result<String, PageFailure> {
        let mut next = self
            .next_page
            .lock()
            .map_err(|_| PageFailure::Refused(POISONED.to_owned()))?;
        *next += 1;
        Ok(next.to_string())
    }

    fn remember(
        &self,
        page_id: String,
        sender: oneshot::Sender<PageAnswer>,
    ) -> Result<(), PageFailure> {
        self.pending
            .lock()
            .map_err(|_| PageFailure::Refused(POISONED.to_owned()))?
            .insert(page_id, sender);
        Ok(())
    }

    fn forget(&self, page_id: &str) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.remove(page_id);
        }
    }

    async fn request_page(&self, url: &str) -> Result<OpenedPage, PageFailure> {
        let page_id = self.take_page_id()?;
        let (sender, receiver) = oneshot::channel();
        self.remember(page_id.clone(), sender)?;
        self.app
            .emit(OPEN_EVENT, format!("{page_id} {url}"))
            .map_err(|error| PageFailure::Refused(error.to_string()))?;
        let waited = timeout(OPEN_TIMEOUT, receiver).await;
        let Ok(answered) = waited else {
            self.forget(&page_id);
            let _ = self.app.emit(CLOSE_EVENT, page_id);
            return Err(PageFailure::Unreachable);
        };
        match answered {
            Ok(Ok(())) => Ok(OpenedPage::create(page_id)),
            Ok(Err(message)) => Err(PageFailure::Refused(message)),
            Err(_) => Err(PageFailure::Unreachable),
        }
    }
}

impl PageOpener for TauriPages {
    fn open_page<'opener>(&'opener self, url: &'opener str) -> OpeningPage<'opener> {
        Box::pin(self.request_page(url))
    }

    fn close_page(&self, page: &OpenedPage) {
        let _ = self.app.emit(CLOSE_EVENT, page.id().to_owned());
    }
}

#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "a tauri command receives its arguments by value"
)]
pub(crate) fn report_page(pages: State<'_, Arc<TauriPages>>, page: String, error: Option<String>) {
    pages.report(&page, error);
}
