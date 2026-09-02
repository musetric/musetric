use rusqlite::{Connection, OptionalExtension, Result};

pub struct Preview {
    pub blob_id: String,
    pub filename: String,
    pub content_type: String,
}

pub(crate) fn read_preview(connection: &Connection, preview_id: i64) -> Result<Option<Preview>> {
    connection
        .query_row(
            "SELECT blobId, filename, contentType FROM Preview WHERE id = ?1",
            [preview_id],
            |row| {
                Ok(Preview {
                    blob_id: row.get(0)?,
                    filename: row.get(1)?,
                    content_type: row.get(2)?,
                })
            },
        )
        .optional()
}
