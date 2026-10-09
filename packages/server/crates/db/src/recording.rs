use rusqlite::{Connection, OptionalExtension, Result, Row, Transaction};

const NAME_PREFIX: &str = "recording ";
const RECORDING_COLUMNS: &str =
    "id, projectId, name, active, freshApplied, waveBlobId, sampleRate, frameCount";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RecordingAudio {
    pub wave_blob_id: String,
    pub sample_rate: i64,
    pub frame_count: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Recording {
    pub id: i64,
    pub project_id: i64,
    pub name: String,
    pub active: bool,
    pub fresh_applied: bool,
    pub audio: Option<RecordingAudio>,
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

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RecordingOutcome {
    Done,
    Missing,
    Refused,
}

fn read_row(row: &Row) -> Result<Recording> {
    let stored: (Option<String>, Option<i64>, Option<i64>) =
        (row.get(5)?, row.get(6)?, row.get(7)?);
    let audio = match stored {
        (Some(wave_blob_id), Some(sample_rate), Some(frame_count)) => Some(RecordingAudio {
            wave_blob_id,
            sample_rate,
            frame_count,
        }),
        _ => None,
    };
    Ok(Recording {
        id: row.get(0)?,
        project_id: row.get(1)?,
        name: row.get(2)?,
        active: row.get(3)?,
        fresh_applied: row.get(4)?,
        audio,
    })
}

pub(crate) fn read_recording(
    connection: &Connection,
    recording_id: i64,
) -> Result<Option<Recording>> {
    connection
        .query_row(
            &format!("SELECT {RECORDING_COLUMNS} FROM Recording WHERE id = ?1"),
            [recording_id],
            read_row,
        )
        .optional()
}

pub(crate) fn read_recordings(connection: &Connection, project_id: i64) -> Result<Vec<Recording>> {
    let mut statement = connection.prepare(&format!(
        "SELECT {RECORDING_COLUMNS} FROM Recording WHERE projectId = ?1 ORDER BY id"
    ))?;
    let rows = statement.query_map([project_id], read_row)?;
    rows.collect()
}

pub(crate) fn read_recording_pieces(
    connection: &Connection,
    recording_id: i64,
) -> Result<Vec<RecordingPiece>> {
    let mut statement = connection.prepare(
        "SELECT blobId, layer, songStartFrame, frameCount, tempo FROM RecordingPiece
         WHERE recordingId = ?1 ORDER BY songStartFrame, id",
    )?;
    let rows = statement.query_map([recording_id], |row| {
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

fn next_name(names: &[String]) -> String {
    let last = names
        .iter()
        .filter_map(|name| {
            name.to_lowercase()
                .strip_prefix(NAME_PREFIX)?
                .parse::<u32>()
                .ok()
        })
        .max()
        .unwrap_or(0);
    format!("Recording {}", last.saturating_add(1))
}

pub(crate) fn insert_recording(transaction: &Transaction, project_id: i64) -> Result<i64> {
    let names = {
        let mut statement =
            transaction.prepare("SELECT name FROM Recording WHERE projectId = ?1")?;
        let rows = statement.query_map([project_id], |row| row.get::<_, String>(0))?;
        rows.collect::<Result<Vec<_>>>()?
    };
    transaction.execute(
        "UPDATE Recording SET active = 0 WHERE projectId = ?1 AND active = 1",
        [project_id],
    )?;
    transaction.execute(
        "INSERT INTO Recording (projectId, name, active) VALUES (?1, ?2, 1)",
        (project_id, next_name(&names)),
    )?;
    Ok(transaction.last_insert_rowid())
}

fn read_active(
    transaction: &Transaction,
    project_id: i64,
    recording_id: i64,
) -> Result<Option<bool>> {
    transaction
        .query_row(
            "SELECT active FROM Recording WHERE id = ?1 AND projectId = ?2",
            (recording_id, project_id),
            |row| row.get(0),
        )
        .optional()
}

pub(crate) fn write_recording_name(
    transaction: &Transaction,
    project_id: i64,
    recording_id: i64,
    name: &str,
) -> Result<RecordingOutcome> {
    if read_active(transaction, project_id, recording_id)?.is_none() {
        return Ok(RecordingOutcome::Missing);
    }
    let taken = transaction
        .query_row(
            "SELECT 1 FROM Recording WHERE projectId = ?1 AND id <> ?2 AND name = ?3",
            (project_id, recording_id, name),
            |_| Ok(()),
        )
        .optional()?;
    if taken.is_some() {
        return Ok(RecordingOutcome::Refused);
    }
    transaction.execute(
        "UPDATE Recording SET name = ?2 WHERE id = ?1",
        (recording_id, name),
    )?;
    Ok(RecordingOutcome::Done)
}

pub(crate) fn write_active_recording(
    transaction: &Transaction,
    project_id: i64,
    recording_id: i64,
) -> Result<RecordingOutcome> {
    if read_active(transaction, project_id, recording_id)?.is_none() {
        return Ok(RecordingOutcome::Missing);
    }
    transaction.execute(
        "UPDATE Recording SET active = 0 WHERE projectId = ?1 AND active = 1 AND id <> ?2",
        (project_id, recording_id),
    )?;
    transaction.execute(
        "UPDATE Recording SET active = 1 WHERE id = ?1",
        [recording_id],
    )?;
    Ok(RecordingOutcome::Done)
}

pub(crate) fn delete_recording(
    transaction: &Transaction,
    project_id: i64,
    recording_id: i64,
) -> Result<RecordingOutcome> {
    let Some(active) = read_active(transaction, project_id, recording_id)? else {
        return Ok(RecordingOutcome::Missing);
    };
    let Some(neighbour) = transaction
        .query_row(
            "SELECT id FROM Recording WHERE projectId = ?1 AND id <> ?2
             ORDER BY id < ?2 DESC, ABS(id - ?2) LIMIT 1",
            (project_id, recording_id),
            |row| row.get::<_, i64>(0),
        )
        .optional()?
    else {
        return Ok(RecordingOutcome::Refused);
    };
    transaction.execute("DELETE FROM Recording WHERE id = ?1", [recording_id])?;
    if active {
        transaction.execute("UPDATE Recording SET active = 1 WHERE id = ?1", [neighbour])?;
    }
    Ok(RecordingOutcome::Done)
}

pub(crate) fn write_recording_audio(
    transaction: &Transaction,
    recording_id: i64,
    audio: &RecordingAudio,
) -> Result<()> {
    transaction.execute(
        "UPDATE Recording SET waveBlobId = ?2, sampleRate = ?3, frameCount = ?4 WHERE id = ?1",
        (
            recording_id,
            &audio.wave_blob_id,
            audio.sample_rate,
            audio.frame_count,
        ),
    )?;
    Ok(())
}

pub(crate) fn write_fresh_applied(
    transaction: &Transaction,
    recording_id: i64,
    fresh_applied: bool,
) -> Result<()> {
    transaction.execute(
        "UPDATE Recording SET freshApplied = ?2 WHERE id = ?1",
        (recording_id, fresh_applied),
    )?;
    Ok(())
}

pub(crate) fn write_recording_pieces(
    transaction: &Transaction,
    recording_id: i64,
    pieces: &[RecordingPiece],
) -> Result<()> {
    transaction.execute(
        "DELETE FROM RecordingPiece WHERE recordingId = ?1",
        [recording_id],
    )?;
    for piece in pieces {
        transaction.execute(
            "INSERT INTO RecordingPiece
               (recordingId, blobId, layer, songStartFrame, frameCount, tempo)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            (
                recording_id,
                &piece.blob_id,
                piece.layer.name(),
                piece.song_start_frame,
                piece.frame_count,
                piece.tempo,
            ),
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::next_name;

    #[test]
    fn names_a_recording_after_the_highest_number() {
        let names = ["Recording 1", "Slow verse", "recording 4"].map(str::to_owned);

        assert_eq!(next_name(&names), "Recording 5");
        assert_eq!(next_name(&[]), "Recording 1");
    }
}
