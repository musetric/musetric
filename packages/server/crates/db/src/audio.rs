use rusqlite::{Connection, OptionalExtension, Result};

pub const MASTER_TYPES: [MasterType; 4] = [
    MasterType::Source,
    MasterType::Lead,
    MasterType::Backing,
    MasterType::Instrumental,
];

pub const STEM_TYPES: [StemType; 3] = [StemType::Lead, StemType::Backing, StemType::Instrumental];

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

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StemType {
    Lead,
    Backing,
    Instrumental,
}

impl StemType {
    #[must_use]
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "lead" => Some(Self::Lead),
            "backing" => Some(Self::Backing),
            "instrumental" => Some(Self::Instrumental),
            _ => None,
        }
    }

    #[must_use]
    pub fn name(self) -> &'static str {
        match self {
            Self::Lead => "lead",
            Self::Backing => "backing",
            Self::Instrumental => "instrumental",
        }
    }
}

pub struct AudioDelivery {
    pub blob_id: String,
    pub wave_blob_id: String,
}

pub struct Recording {
    pub blob_id: String,
    pub wave_blob_id: String,
    pub sample_rate: i64,
    pub frame_count: i64,
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

pub(crate) fn read_delivery(
    connection: &Connection,
    project_id: i64,
    stem: StemType,
) -> Result<Option<AudioDelivery>> {
    connection
        .query_row(
            "SELECT blobId, waveBlobId FROM AudioDelivery WHERE projectId = ?1 AND stemType = ?2",
            (project_id, stem.name()),
            |row| {
                Ok(AudioDelivery {
                    blob_id: row.get(0)?,
                    wave_blob_id: row.get(1)?,
                })
            },
        )
        .optional()
}

pub(crate) fn read_recording(
    connection: &Connection,
    project_id: i64,
) -> Result<Option<Recording>> {
    connection
        .query_row(
            "SELECT blobId, waveBlobId, sampleRate, frameCount FROM Recording WHERE projectId = ?1",
            [project_id],
            |row| {
                Ok(Recording {
                    blob_id: row.get(0)?,
                    wave_blob_id: row.get(1)?,
                    sample_rate: row.get(2)?,
                    frame_count: row.get(3)?,
                })
            },
        )
        .optional()
}
