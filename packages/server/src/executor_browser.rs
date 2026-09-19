use std::{
    env,
    io::{self, Write},
    path::{self, Path, PathBuf},
    process::{ExitStatus, Stdio},
    time::Duration,
};

use musetric_db::BoxedError;
use tokio::{process::Command, task::JoinHandle, time::sleep};

const RESTART_DELAY: Duration = Duration::from_secs(3);
const PROFILE_DIRECTORY: &str = "executor-browser";
const BROWSER_ARGS: [&str; 10] = [
    "--headless=new",
    "--no-first-run",
    "--no-default-browser-check",
    "--enable-unsafe-webgpu",
    "--ignore-gpu-blocklist",
    "--force_high_performance_gpu",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    "--disable-extensions",
];
#[cfg(target_os = "linux")]
const PLATFORM_ARGS: [&str; 1] = ["--enable-features=Vulkan"];
#[cfg(not(target_os = "linux"))]
const PLATFORM_ARGS: [&str; 0] = [];

pub(crate) struct ExecutorBrowserOptions {
    pub(crate) executable: PathBuf,
    pub(crate) work: PathBuf,
    pub(crate) url: String,
}

pub(crate) struct ExecutorBrowser {
    supervisor: JoinHandle<()>,
}

impl ExecutorBrowser {
    pub(crate) fn start(options: ExecutorBrowserOptions) -> Result<Self, BoxedError> {
        let profile = path::absolute(options.work.join(PROFILE_DIRECTORY))?;
        #[cfg(target_os = "windows")]
        let job = create_job()?;
        let supervisor = tokio::spawn(async move {
            loop {
                #[cfg(target_os = "windows")]
                let exited = run_browser(&options.executable, &profile, &options.url, &job).await;
                #[cfg(not(target_os = "windows"))]
                let exited = run_browser(&options.executable, &profile, &options.url).await;
                let reason =
                    exited.map_or_else(|error| error.to_string(), |status| status.to_string());
                let _ = writeln!(
                    io::stderr().lock(),
                    "The executor browser exited ({reason}); starting it again"
                );
                sleep(RESTART_DELAY).await;
            }
        });
        Ok(Self { supervisor })
    }
}

impl Drop for ExecutorBrowser {
    fn drop(&mut self) {
        self.supervisor.abort();
    }
}

async fn run_browser(
    executable: &Path,
    profile: &Path,
    url: &str,
    #[cfg(target_os = "windows")] job: &win32job::Job,
) -> Result<ExitStatus, BoxedError> {
    let mut child = Command::new(executable)
        .arg(format!("--user-data-dir={}", profile.display()))
        .args(BROWSER_ARGS)
        .args(PLATFORM_ARGS)
        .arg(url)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()?;
    #[cfg(target_os = "windows")]
    {
        let handle = child
            .raw_handle()
            .ok_or("the executor browser has no process handle")?;
        job.assign_process(handle as isize)?;
    }
    Ok(child.wait().await?)
}

#[cfg(target_os = "windows")]
fn create_job() -> Result<win32job::Job, BoxedError> {
    let mut info = win32job::ExtendedLimitInfo::new();
    info.limit_kill_on_job_close();
    Ok(win32job::Job::create_with_limit_info(&info)?)
}

#[must_use]
pub(crate) fn find_browser() -> Option<PathBuf> {
    browser_candidates().into_iter().find(|path| path.is_file())
}

#[cfg(target_os = "windows")]
fn browser_candidates() -> Vec<PathBuf> {
    let roots = ["ProgramFiles", "ProgramFiles(x86)", "LocalAppData"]
        .into_iter()
        .filter_map(env::var_os)
        .map(PathBuf::from);
    roots
        .flat_map(|root| {
            [
                root.join("Google/Chrome/Application/chrome.exe"),
                root.join("Microsoft/Edge/Application/msedge.exe"),
            ]
        })
        .collect()
}

#[cfg(target_os = "macos")]
fn browser_candidates() -> Vec<PathBuf> {
    [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ]
    .into_iter()
    .map(PathBuf::from)
    .collect()
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn browser_candidates() -> Vec<PathBuf> {
    let names = [
        "google-chrome",
        "google-chrome-stable",
        "chromium",
        "chromium-browser",
        "microsoft-edge",
    ];
    env::var_os("PATH")
        .map(|paths| {
            env::split_paths(&paths)
                .flat_map(|directory| names.map(|name| directory.join(name)))
                .collect()
        })
        .unwrap_or_default()
}
