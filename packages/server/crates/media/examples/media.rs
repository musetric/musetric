use std::{
    io::{Write, stdout},
    path::PathBuf,
};

use clap::{Parser, Subcommand};
use musetric_media::{
    BoxedError, Tools, analyze_lead_visual_loudness, analyze_loudness, convert_to_flac,
    convert_to_fmp4, generate_wave_peaks, read_frame_count,
};

#[derive(Parser)]
#[command(about = "Runs one media operation the way the backend runs it")]
struct Arguments {
    #[arg(long)]
    ffmpeg: PathBuf,

    #[arg(long)]
    ffprobe: PathBuf,

    #[command(subcommand)]
    operation: Operation,
}

#[derive(Subcommand)]
enum Operation {
    Flac {
        #[arg(long)]
        from: PathBuf,
        #[arg(long)]
        to: PathBuf,
        #[arg(long)]
        sample_rate: u32,
    },
    Fmp4 {
        #[arg(long)]
        from: PathBuf,
        #[arg(long)]
        to: PathBuf,
        #[arg(long)]
        sample_rate: u32,
    },
    Peaks {
        #[arg(long)]
        from: PathBuf,
        #[arg(long)]
        to: PathBuf,
        #[arg(long)]
        sample_rate: u32,
    },
    Frames {
        #[arg(long)]
        from: PathBuf,
        #[arg(long)]
        sample_rate: u32,
    },
    Loudness {
        #[arg(long)]
        from: PathBuf,
    },
    LeadLoudness {
        #[arg(long)]
        from: PathBuf,
        #[arg(long)]
        sample_rate: u32,
    },
}

#[tokio::main]
async fn main() -> Result<(), BoxedError> {
    let arguments = Arguments::parse();
    let tools = Tools {
        ffmpeg: arguments.ffmpeg,
        ffprobe: arguments.ffprobe,
    };
    let reported = run(&tools, arguments.operation).await?;
    let mut output = stdout().lock();
    writeln!(output, "{reported}")?;
    output.flush()?;
    Ok(())
}

async fn run(tools: &Tools, operation: Operation) -> Result<String, BoxedError> {
    match operation {
        Operation::Flac {
            from,
            to,
            sample_rate,
        } => {
            convert_to_flac(tools, &from, &to, sample_rate).await?;
            Ok(String::new())
        }
        Operation::Fmp4 {
            from,
            to,
            sample_rate,
        } => {
            convert_to_fmp4(tools, &from, &to, sample_rate).await?;
            Ok(String::new())
        }
        Operation::Peaks {
            from,
            to,
            sample_rate,
        } => {
            generate_wave_peaks(tools, &from, &to, sample_rate).await?;
            Ok(String::new())
        }
        Operation::Frames { from, sample_rate } => {
            let frames = read_frame_count(tools, &from, sample_rate).await?;
            Ok(frames.to_string())
        }
        Operation::Loudness { from } => {
            let loudness = analyze_loudness(tools, &from).await?;
            Ok(serde_json::json!({
                "integratedLoudnessDb": loudness.integrated_loudness_db,
                "truePeakDb": loudness.true_peak_db,
            })
            .to_string())
        }
        Operation::LeadLoudness { from, sample_rate } => {
            let lead = analyze_lead_visual_loudness(tools, &from, sample_rate).await?;
            Ok(serde_json::json!({
                "integratedLoudnessDb": lead.loudness.integrated_loudness_db,
                "truePeakDb": lead.loudness.true_peak_db,
                "p95RmsDb": lead.p95_rms_db,
            })
            .to_string())
        }
    }
}
