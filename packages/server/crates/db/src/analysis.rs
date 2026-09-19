use std::collections::HashMap;

use rusqlite::{Connection, OptionalExtension, Params, Result, Transaction};

use crate::audio::MasterType;

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

pub struct StemLoudness {
    pub stem: MasterType,
    pub integrated_lufs: f64,
    pub true_peak_db: f64,
    pub p95_rms_db: Option<f64>,
}

pub(crate) fn read_stem_loudness(
    connection: &Connection,
    project_id: i64,
) -> Result<Vec<StemLoudness>> {
    Ok(
        query_stem_loudness(connection, "WHERE projectId = ?1", [project_id])?
            .into_iter()
            .map(|(_, measured)| measured)
            .collect(),
    )
}

pub(crate) fn read_all_stem_loudness(
    connection: &Connection,
) -> Result<HashMap<i64, Vec<StemLoudness>>> {
    let mut grouped: HashMap<i64, Vec<StemLoudness>> = HashMap::new();
    for (project_id, measured) in query_stem_loudness(connection, "", [])? {
        grouped.entry(project_id).or_default().push(measured);
    }
    Ok(grouped)
}

fn query_stem_loudness(
    connection: &Connection,
    filter: &str,
    params: impl Params,
) -> Result<Vec<(i64, StemLoudness)>> {
    let mut statement = connection.prepare(&format!(
        "SELECT projectId, stemType, integratedLufs, truePeakDb, p95RmsDb
         FROM StemLoudness {filter}"
    ))?;
    let rows = statement.query_map(params, |row| {
        let name: String = row.get(1)?;
        Ok((row.get(0)?, name, row.get(2)?, row.get(3)?, row.get(4)?))
    })?;
    let mut measured = Vec::new();
    for row in rows {
        let (project_id, name, integrated_lufs, true_peak_db, p95_rms_db) = row?;
        if let Some(stem) = MasterType::parse(&name) {
            measured.push((
                project_id,
                StemLoudness {
                    stem,
                    integrated_lufs,
                    true_peak_db,
                    p95_rms_db,
                },
            ));
        }
    }
    Ok(measured)
}

pub(crate) fn write_stem_loudness(
    transaction: &Transaction,
    project_id: i64,
    measured: &StemLoudness,
) -> Result<usize> {
    transaction.execute(
        "INSERT INTO StemLoudness (projectId, stemType, integratedLufs, truePeakDb, p95RmsDb)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(projectId, stemType) DO UPDATE SET
           integratedLufs = excluded.integratedLufs,
           truePeakDb = excluded.truePeakDb,
           p95RmsDb = excluded.p95RmsDb",
        (
            project_id,
            measured.stem.name(),
            measured.integrated_lufs,
            measured.true_peak_db,
            measured.p95_rms_db,
        ),
    )
}
