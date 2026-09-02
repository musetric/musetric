use rusqlite::{Connection, OptionalExtension, Result};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Analysis {
    Chords,
    Key,
    Rhythm,
    Subtitle,
}

impl Analysis {
    #[must_use]
    pub fn table(self) -> &'static str {
        match self {
            Self::Chords => "Chords",
            Self::Key => "Key",
            Self::Rhythm => "Rhythm",
            Self::Subtitle => "Subtitle",
        }
    }
}

pub(crate) fn read_analysis_blob(
    connection: &Connection,
    analysis: Analysis,
    project_id: i64,
) -> Result<Option<String>> {
    let table = analysis.table();
    connection
        .query_row(
            &format!("SELECT blobId FROM {table} WHERE projectId = ?1"),
            [project_id],
            |row| row.get(0),
        )
        .optional()
}
