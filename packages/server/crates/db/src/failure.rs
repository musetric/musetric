use std::{
    error::Error,
    fmt::{Display, Formatter, Result as FmtResult},
    path::{Path, PathBuf},
};

pub type BoxedError = Box<dyn Error + Send + Sync>;

#[derive(Debug)]
pub struct MigrationFailure {
    message: String,
    committed_version: Option<usize>,
    backup_path: Option<PathBuf>,
    cause: Option<BoxedError>,
}

impl MigrationFailure {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            committed_version: None,
            backup_path: None,
            cause: None,
        }
    }

    #[must_use]
    pub fn caused_by(mut self, cause: impl Into<BoxedError>) -> Self {
        self.cause = Some(cause.into());
        self
    }

    #[must_use]
    pub fn committed(mut self, version: usize) -> Self {
        self.committed_version = Some(version);
        self
    }

    #[must_use]
    pub fn backed_up(mut self, path: Option<&Path>) -> Self {
        self.backup_path = path.map(Path::to_path_buf);
        self
    }

    #[must_use]
    pub fn committed_version(&self) -> Option<usize> {
        self.committed_version
    }

    #[must_use]
    pub fn backup_path(&self) -> Option<&Path> {
        self.backup_path.as_deref()
    }
}

impl Display for MigrationFailure {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> FmtResult {
        match &self.cause {
            Some(cause) => write!(formatter, "{}: {cause}", self.message),
            None => formatter.write_str(&self.message),
        }
    }
}

impl Error for MigrationFailure {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        self.cause
            .as_ref()
            .map(|cause| cause.as_ref() as &dyn Error)
    }
}
