use std::{collections::HashMap, path::Path};

use axum::extract::Multipart;
use tokio::io::AsyncWriteExt;

use crate::{
    blobs::{create_blob_file, create_blob_ref, discard_blob},
    failure::Failure,
};

const DEFAULT_CONTENT_TYPE: &str = "application/octet-stream";

pub(crate) struct UploadedFile {
    pub(crate) blob_id: String,
    pub(crate) filename: String,
    pub(crate) content_type: String,
}

pub(crate) enum FormValue {
    Text(String),
    File(UploadedFile),
}

pub(crate) enum Field<'form> {
    Missing,
    Text(&'form str),
    File(&'form UploadedFile),
}

impl Field<'_> {
    pub(crate) fn describe(&self) -> &'static str {
        match self {
            Self::Missing => "undefined",
            Self::Text(_) => "string",
            Self::File(_) => "file",
        }
    }
}

pub(crate) struct Form {
    values: HashMap<String, FormValue>,
}

impl Form {
    pub(crate) fn field(&self, name: &str) -> Field<'_> {
        match self.values.get(name) {
            None => Field::Missing,
            Some(FormValue::Text(value)) => Field::Text(value),
            Some(FormValue::File(file)) => Field::File(file),
        }
    }

    pub(crate) async fn discard(&self, blobs_path: &Path) {
        for value in self.values.values() {
            if let FormValue::File(file) = value {
                discard_blob(blobs_path, &file.blob_id).await;
            }
        }
    }
}

pub(crate) async fn read_form(
    mut multipart: Multipart,
    blobs_path: &Path,
) -> Result<Form, Failure> {
    let mut values = HashMap::new();
    while let Some(mut field) = multipart.next_field().await.map_err(Failure::failed)? {
        let name = field.name().unwrap_or_default().to_owned();
        let uploaded_name = field.file_name().map(ToOwned::to_owned);
        let content_type = field
            .content_type()
            .unwrap_or(DEFAULT_CONTENT_TYPE)
            .to_owned();
        let value = match uploaded_name {
            Some(filename) => {
                let blob_id = store_field(&mut field, blobs_path).await?;
                FormValue::File(UploadedFile {
                    blob_id,
                    filename,
                    content_type,
                })
            }
            None => FormValue::Text(field.text().await.map_err(Failure::failed)?),
        };
        values.insert(name, value);
    }
    Ok(Form { values })
}

async fn store_field(
    field: &mut axum::extract::multipart::Field<'_>,
    blobs_path: &Path,
) -> Result<String, Failure> {
    let reference = create_blob_ref(blobs_path);
    let mut file = create_blob_file(&reference)
        .await
        .map_err(Failure::failed)?;
    while let Some(chunk) = field.chunk().await.map_err(Failure::failed)? {
        file.write_all(&chunk).await.map_err(Failure::failed)?;
    }
    file.flush().await.map_err(Failure::failed)?;
    Ok(reference.blob_id)
}
