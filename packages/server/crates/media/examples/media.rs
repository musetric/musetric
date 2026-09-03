use std::{
    io::{Write, stdout},
    path::PathBuf,
};

use clap::{Parser, Subcommand};
use musetric_media::{
    BoxedError, PcmRequest, SampleRates, SymphoniaPcm, Tools, WavePeaks,
    analyze_lead_visual_loudness, analyze_loudness, convert_to_flac, convert_to_fmp4,
    encode_flac_from_raw, generate_wave_peaks, read_frame_count,
};

#[derive(Parser)]
#[command(about = "Runs one media operation the way the backend runs it")]
struct Arguments {
    #[arg(long)]
    ffmpeg: PathBuf,

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
    RawFlac {
        #[arg(long)]
        from: PathBuf,
        #[arg(long)]
        to: PathBuf,
        #[arg(long)]
        input_sample_rate: u32,
        #[arg(long)]
        output_sample_rate: u32,
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
    },
    Loudness {
        #[arg(long)]
        from: PathBuf,
        #[arg(long)]
        sample_rate: u32,
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
    let media = Media {
        pcm: SymphoniaPcm,
        tools: Tools {
            ffmpeg: arguments.ffmpeg,
        },
    };
    let reported = run(&media, arguments.operation).await?;
    let mut output = stdout().lock();
    writeln!(output, "{reported}")?;
    output.flush()?;
    Ok(())
}

struct Media {
    pcm: SymphoniaPcm,
    tools: Tools,
}

fn read_at(from: &PathBuf, sample_rate: u32) -> PcmRequest<'_> {
    PcmRequest { from, sample_rate }
}

async fn run(media: &Media, operation: Operation) -> Result<String, BoxedError> {
    match operation {
        Operation::Flac {
            from,
            to,
            sample_rate,
        } => {
            convert_to_flac(&media.pcm, read_at(&from, sample_rate), &to).await?;
            Ok(String::new())
        }
        Operation::RawFlac {
            from,
            to,
            input_sample_rate,
            output_sample_rate,
        } => {
            let rates = SampleRates {
                input: input_sample_rate,
                output: output_sample_rate,
            };
            encode_flac_from_raw(&from, &to, rates).await?;
            Ok(String::new())
        }
        Operation::Fmp4 {
            from,
            to,
            sample_rate,
        } => {
            convert_to_fmp4(&media.tools, &from, &to, sample_rate).await?;
            Ok(String::new())
        }
        Operation::Peaks {
            from,
            to,
            sample_rate,
        } => {
            let request = WavePeaks {
                source: read_at(&from, sample_rate),
                to: &to,
                total_frames: read_frame_count(&from).await?,
            };
            generate_wave_peaks(&media.pcm, &request).await?;
            Ok(String::new())
        }
        Operation::Frames { from } => {
            let frames = read_frame_count(&from).await?;
            Ok(frames.to_string())
        }
        Operation::Loudness { from, sample_rate } => {
            let loudness = analyze_loudness(&media.pcm, read_at(&from, sample_rate)).await?;
            Ok(serde_json::json!({
                "integratedLoudnessDb": loudness.integrated_loudness_db,
                "truePeakDb": loudness.true_peak_db,
            })
            .to_string())
        }
        Operation::LeadLoudness { from, sample_rate } => {
            let lead =
                analyze_lead_visual_loudness(&media.pcm, read_at(&from, sample_rate)).await?;
            Ok(serde_json::json!({
                "integratedLoudnessDb": lead.loudness.integrated_loudness_db,
                "truePeakDb": lead.loudness.true_peak_db,
                "p95RmsDb": lead.p95_rms_db,
            })
            .to_string())
        }
    }
}
