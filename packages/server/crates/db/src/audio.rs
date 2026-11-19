use rusqlite::{Connection, OptionalExtension, Result};

pub const MASTER_TYPES: [MasterType; 4] = [
    MasterType::Source,
    MasterType::Lead,
    MasterType::Backing,
    MasterType::Instrumental,
];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MasterType {
    Source,
    Lead,
    Backing,
    Instrumental,
}

impl MasterType {
    #[must_use]
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "source" => Some(Self::Source),
            "lead" => Some(Self::Lead),
            "backing" => Some(Self::Backing),
            "instrumental" => Some(Self::Instrumental),
            _ => None,
        }
    }

    #[must_use]
    pub fn name(self) -> &'static str {
        match self {
            Self::Source => "source",
            Self::Lead => "lead",
            Self::Backing => "backing",
            Self::Instrumental => "instrumental",
        }
    }
}

pub(crate) fn read_master_blob(
    connection: &Connection,
    project_id: i64,
    master: MasterType,
) -> Result<Option<String>> {
    connection
        .query_row(
            "SELECT blobId FROM AudioMaster WHERE projectId = ?1 AND type = ?2",
            (project_id, master.name()),
            |row| row.get(0),
        )
        .optional()
}

pub(crate) fn read_wave_blob(
    connection: &Connection,
    project_id: i64,
    master: MasterType,
) -> Result<Option<String>> {
    connection
        .query_row(
            "SELECT waveBlobId FROM AudioMaster WHERE projectId = ?1 AND type = ?2",
            (project_id, master.name()),
            |row| row.get(0),
        )
        .optional()
        .map(Option::flatten)
}
