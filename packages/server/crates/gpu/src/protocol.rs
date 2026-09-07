use serde_json::{Value, json};

pub(crate) const JOB_URL_PARAMETER: &str = "jobs";
pub(crate) const JOB_SOCKET_PATH: &str = "/jobs";
pub(crate) const UPLOAD_ROUTE: &str = "/uploads/";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ExecutorPass {
    Decode,
    Repair,
}

impl ExecutorPass {
    fn parse(value: &str) -> Option<Self> {
        match value {
            "decode" => Some(Self::Decode),
            "repair" => Some(Self::Repair),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum ExecutorPhase {
    Loading,
    Running {
        pass: ExecutorPass,
        unit: u32,
        unit_count: u32,
    },
}

pub(crate) enum ExecutorMessage {
    Ready { adapter: bool, shader_f16: bool },
    Phase(ExecutorPhase),
    Answer { job_id: String, result: Value },
    Failure { job_id: String, error: String },
}

pub(crate) fn read_executor_message(text: &str) -> Option<ExecutorMessage> {
    let message: Value = serde_json::from_str(text).ok()?;
    let kind = message.get("type")?.as_str()?;
    if kind == "ready" {
        return Some(ExecutorMessage::Ready {
            adapter: read_flag(&message, "adapter"),
            shader_f16: read_flag(&message, "shaderF16"),
        });
    }
    let job_id = message.get("jobId")?.as_str()?.to_owned();
    match kind {
        "loading" => Some(ExecutorMessage::Phase(ExecutorPhase::Loading)),
        "running" => read_running(&message).map(ExecutorMessage::Phase),
        "result" => Some(ExecutorMessage::Answer {
            job_id,
            result: message.get("result").cloned().unwrap_or(Value::Null),
        }),
        "failed" => Some(ExecutorMessage::Failure {
            job_id,
            error: message.get("error")?.as_str()?.to_owned(),
        }),
        _ => None,
    }
}

fn read_running(message: &Value) -> Option<ExecutorPhase> {
    Some(ExecutorPhase::Running {
        pass: ExecutorPass::parse(message.get("pass")?.as_str()?)?,
        unit: read_count(message, "unit")?,
        unit_count: read_count(message, "unitCount")?,
    })
}

fn read_count(message: &Value, name: &str) -> Option<u32> {
    u32::try_from(message.get(name)?.as_u64()?).ok()
}

pub(crate) fn write_job_command(
    job_id: &str,
    api: &str,
    upload_url: &str,
    request: &Value,
) -> String {
    json!({
        "type": "job",
        "jobId": job_id,
        "api": api,
        "uploadUrl": upload_url,
        "request": request,
    })
    .to_string()
}

fn read_flag(message: &Value, name: &str) -> bool {
    message.get(name).and_then(Value::as_bool).unwrap_or(false)
}
