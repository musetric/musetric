use std::{path::Path, sync::Mutex};

use rusqlite::Connection;

use crate::{
    analysis::{Analysis, read_analysis_blob},
    database::{OpenOptions, open_database},
    failure::BoxedError,
    project::read_project_name,
};

pub struct Reader {
    connection: Mutex<Connection>,
}

impl Reader {
    pub fn open(database_path: &Path) -> Result<Self, BoxedError> {
        let connection = open_database(
            database_path,
            &OpenOptions {
                foreign_keys: false,
            },
        )?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    pub fn analysis_blob(
        &self,
        analysis: Analysis,
        project_id: i64,
    ) -> Result<Option<String>, BoxedError> {
        self.read(|connection| read_analysis_blob(connection, analysis, project_id))
    }

    pub fn project_name(&self, project_id: i64) -> Result<Option<String>, BoxedError> {
        self.read(|connection| read_project_name(connection, project_id))
    }

    fn read<Value>(
        &self,
        query: impl FnOnce(&Connection) -> Result<Value, rusqlite::Error>,
    ) -> Result<Value, BoxedError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| "the database connection is no longer usable")?;
        Ok(query(&connection)?)
    }
}
