use std::{future::Future, pin::Pin};

pub enum PageFailure {
    Refused(String),
    Unreachable,
}

pub struct OpenedPage {
    id: String,
}

impl OpenedPage {
    #[must_use]
    pub fn create(id: String) -> Self {
        Self { id }
    }

    #[must_use]
    pub fn id(&self) -> &str {
        &self.id
    }
}

pub type OpeningPage<'opening> =
    Pin<Box<dyn Future<Output = Result<OpenedPage, PageFailure>> + Send + 'opening>>;

pub trait PageOpener: Send + Sync {
    fn open_page<'opener>(&'opener self, url: &'opener str) -> OpeningPage<'opener>;
    fn close_page(&self, page: &OpenedPage);
}

pub struct HeldPage<'opener> {
    opener: &'opener dyn PageOpener,
    page: OpenedPage,
}

impl<'opener> HeldPage<'opener> {
    #[must_use]
    pub fn hold(opener: &'opener dyn PageOpener, page: OpenedPage) -> Self {
        Self { opener, page }
    }
}

impl Drop for HeldPage<'_> {
    fn drop(&mut self) {
        self.opener.close_page(&self.page);
    }
}

pub struct ClosedPages;

impl PageOpener for ClosedPages {
    fn open_page<'opener>(&'opener self, _url: &'opener str) -> OpeningPage<'opener> {
        Box::pin(async { Err(PageFailure::Unreachable) })
    }

    fn close_page(&self, _page: &OpenedPage) {}
}
