use rusqlite::{Connection, OptionalExtension, Result};

pub const MASTER_TYPES: [MasterType; 5] = [
    MasterType::Source,
    MasterType::Vocals,
    MasterType::Lead,
    MasterType::Backing,
    MasterType::Instrumental,
];

pub const STEM_TYPES: [StemType; 3] = [StemType::Lead, StemType::Backing, StemType::Instrumental];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MasterType {
    Source,
    Vocals,
    Lead,
    Backing,
    Instrumental,
}

impl MasterType {
    #[must_use]
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "source" => Some(Self::Source),
            "vocals" => Some(Self::Vocals),
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
            Self::Vocals => "vocals",
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
    pub wave_blob_id: String,
    pub sample_rate: i64,
    pub frame_count: i64,
    pub fresh_applied: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RecordingLayer {
    Base,
    Fresh,
}

impl RecordingLayer {
    #[must_use]
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "base" => Some(Self::Base),
            "fresh" => Some(Self::Fresh),
            _ => None,
        }
    }

    #[must_use]
    pub fn name(self) -> &'static str {
        match self {
            Self::Base => "base",
            Self::Fresh => "fresh",
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct RecordingPiece {
    pub blob_id: String,
    pub layer: RecordingLayer,
    pub song_start_frame: i64,
    pub frame_count: i64,
    pub tempo: f64,
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
            "SELECT waveBlobId, sampleRate, frameCount, freshApplied
             FROM Recording WHERE projectId = ?1",
            [project_id],
            |row| {
                Ok(Recording {
                    wave_blob_id: row.get(0)?,
                    sample_rate: row.get(1)?,
                    frame_count: row.get(2)?,
                    fresh_applied: row.get(3)?,
                })
            },
        )
        .optional()
}

pub(crate) fn read_recording_pieces(
    connection: &Connection,
    project_id: i64,
) -> Result<Vec<RecordingPiece>> {
    let mut statement = connection.prepare(
        "SELECT blobId, layer, songStartFrame, frameCount, tempo FROM RecordingPiece
         WHERE projectId = ?1 ORDER BY songStartFrame, id",
    )?;
    let rows = statement.query_map([project_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, i64>(2)?,
            row.get::<_, i64>(3)?,
            row.get::<_, f64>(4)?,
        ))
    })?;
    let mut pieces = Vec::new();
    for row in rows {
        let (blob_id, layer_name, song_start_frame, frame_count, tempo) = row?;
        if let Some(layer) = RecordingLayer::parse(&layer_name) {
            pieces.push(RecordingPiece {
                blob_id,
                layer,
                song_start_frame,
                frame_count,
                tempo,
            });
        }
    }
    Ok(pieces)
}
