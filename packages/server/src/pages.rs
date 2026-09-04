use std::{future::Future, pin::Pin};

#[derive(Debug)]
pub(crate) enum PageFailure {
    Refused(String),
    Unreachable,
}

pub(crate) struct OpenedPage {
    id: String,
}

impl OpenedPage {
    #[must_use]
    pub(crate) fn create(id: String) -> Self {
        Self { id }
    }

    #[must_use]
    pub(crate) fn id(&self) -> &str {
        &self.id
    }
}

pub(crate) type OpeningPage<'opening> =
    Pin<Box<dyn Future<Output = Result<OpenedPage, PageFailure>> + Send + 'opening>>;

pub(crate) trait PageOpener: Send + Sync {
    fn open_page<'opener>(&'opener self, url: &'opener str) -> OpeningPage<'opener>;
    fn close_page(&self, page: &OpenedPage);
}

pub(crate) struct HeldPage<'opener> {
    opener: &'opener dyn PageOpener,
    page: OpenedPage,
}

impl<'opener> HeldPage<'opener> {
    #[must_use]
    pub(crate) fn hold(opener: &'opener dyn PageOpener, page: OpenedPage) -> Self {
        Self { opener, page }
    }
}

impl Drop for HeldPage<'_> {
    fn drop(&mut self) {
        self.opener.close_page(&self.page);
    }
}
