use rusqlite::{Connection, OptionalExtension, Result};

pub(crate) fn read_project_name(
    connection: &Connection,
    project_id: i64,
) -> Result<Option<String>> {
    connection
        .query_row(
            "SELECT name FROM Project WHERE id = ?1",
            [project_id],
            |row| row.get(0),
        )
        .optional()
}
