use rusqlite::{Connection, OptionalExtension, Result, Transaction};

const PROJECT_COLUMNS: &str = "SELECT Project.id, Project.name, Project.sampleRate,
     Project.frameCount, Preview.id, Project.paused, Project.position
     FROM Project
     LEFT JOIN Preview ON Preview.projectId = Project.id";

pub struct ProjectItem {
    pub id: i64,
    pub name: String,
    pub sample_rate: i64,
    pub frame_count: i64,
    pub preview_id: Option<i64>,
    pub paused: bool,
    pub position: i64,
}

fn read_item(row: &rusqlite::Row) -> Result<ProjectItem> {
    Ok(ProjectItem {
        id: row.get(0)?,
        name: row.get(1)?,
        sample_rate: row.get(2)?,
        frame_count: row.get(3)?,
        preview_id: row.get(4)?,
        paused: row.get(5)?,
        position: row.get(6)?,
    })
}

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

pub(crate) fn read_project(
    connection: &Connection,
    project_id: i64,
) -> Result<Option<ProjectItem>> {
    connection
        .query_row(
            &format!("{PROJECT_COLUMNS} WHERE Project.id = ?1"),
            [project_id],
            read_item,
        )
        .optional()
}

pub(crate) fn read_project_paused(connection: &Connection, project_id: i64) -> Result<bool> {
    connection.query_row(
        "SELECT paused FROM Project WHERE id = ?1",
        [project_id],
        |row| row.get(0),
    )
}

pub(crate) fn read_processing_paused(connection: &Connection) -> Result<bool> {
    connection.query_row("SELECT paused FROM Processing WHERE id = 1", [], |row| {
        row.get(0)
    })
}

pub(crate) fn write_processing_paused(transaction: &Transaction, paused: bool) -> Result<()> {
    transaction.execute("UPDATE Processing SET paused = ?1 WHERE id = 1", [paused])?;
    Ok(())
}

pub(crate) fn write_project_paused(
    transaction: &Transaction,
    project_id: i64,
    paused: bool,
) -> Result<bool> {
    let changed = transaction.execute(
        "UPDATE Project SET paused = ?2 WHERE id = ?1",
        (project_id, paused),
    )?;
    Ok(changed > 0)
}

pub(crate) fn write_project_order(transaction: &Transaction, project_ids: &[i64]) -> Result<()> {
    for (position, project_id) in project_ids.iter().enumerate() {
        transaction.execute(
            "UPDATE Project SET position = ?2 WHERE id = ?1",
            (project_id, i64::try_from(position).unwrap_or(i64::MAX)),
        )?;
    }
    Ok(())
}

pub(crate) fn read_projects(connection: &Connection) -> Result<Vec<ProjectItem>> {
    let mut statement =
        connection.prepare(&format!("{PROJECT_COLUMNS} ORDER BY Project.id DESC"))?;
    let rows = statement.query_map([], read_item)?;
    let mut projects = Vec::new();
    for row in rows {
        projects.push(row?);
    }
    Ok(projects)
}
