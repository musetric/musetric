use std::{error::Error, path::Path, process::Stdio};

use tokio::process::Command;

pub type BoxedError = Box<dyn Error + Send + Sync>;

pub(crate) struct Finished {
    pub(crate) stdout: Vec<u8>,
    pub(crate) stderr: String,
}

pub(crate) async fn run(program: &Path, arguments: &[String]) -> Result<Finished, BoxedError> {
    let output = Command::new(program)
        .args(arguments)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await?;
    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
    if !output.status.success() {
        let trimmed = stderr.trim();
        let reported = if trimmed.is_empty() {
            format!(
                "{} failed with exit code {}",
                program.display(),
                describe(output.status.code())
            )
        } else {
            trimmed.to_owned()
        };
        return Err(reported.into());
    }
    Ok(Finished {
        stdout: output.stdout,
        stderr,
    })
}

fn describe(code: Option<i32>) -> String {
    code.map_or_else(|| "unknown".to_owned(), |value| value.to_string())
}
