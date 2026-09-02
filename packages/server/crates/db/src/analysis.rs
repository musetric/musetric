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

pub struct AudioAnalysis {
    pub source_gain_db: f64,
    pub lead_spectrogram_gain_db: f64,
    pub lead_gain_db: f64,
    pub backing_gain_db: f64,
    pub instrumental_gain_db: f64,
}

pub(crate) fn read_audio_analysis(
    connection: &Connection,
    project_id: i64,
) -> Result<Option<AudioAnalysis>> {
    connection
        .query_row(
            "SELECT sourceGainDb, leadSpectrogramGainDb, leadGainDb, backingGainDb,
                    instrumentalGainDb
             FROM ProjectAudioAnalysis
             WHERE projectId = ?1",
            [project_id],
            |row| {
                Ok(AudioAnalysis {
                    source_gain_db: row.get(0)?,
                    lead_spectrogram_gain_db: row.get(1)?,
                    lead_gain_db: row.get(2)?,
                    backing_gain_db: row.get(3)?,
                    instrumental_gain_db: row.get(4)?,
                })
            },
        )
        .optional()
}
