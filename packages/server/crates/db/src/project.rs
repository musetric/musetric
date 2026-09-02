use rusqlite::{Connection, OptionalExtension, Result};

const PROJECT_COLUMNS: &str = "SELECT Project.id, Project.name, Project.sampleRate,
     Project.frameCount, Preview.id
     FROM Project
     LEFT JOIN Preview ON Preview.projectId = Project.id";

pub struct ProjectItem {
    pub id: i64,
    pub name: String,
    pub sample_rate: i64,
    pub frame_count: i64,
    pub preview_id: Option<i64>,
}

fn read_item(row: &rusqlite::Row) -> Result<ProjectItem> {
    Ok(ProjectItem {
        id: row.get(0)?,
        name: row.get(1)?,
        sample_rate: row.get(2)?,
        frame_count: row.get(3)?,
        preview_id: row.get(4)?,
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
