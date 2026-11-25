use std::path::{Path, PathBuf};

use musetric_db::{MasterType, NewStem};
use musetric_dsp::resample::SampleRates;
use musetric_media::{
    BoxedError, PcmRequest, PcmSource, WavePeaks, encode_flac_from_raw, generate_wave_peaks,
    read_frame_count,
};

use crate::{
    analysis::separation_sink::SinkStem,
    blobs::{StagedBlob, stage_blob},
};

const RAW_SUFFIX: &str = "raw";

pub(crate) struct StemFiles {
    stem: MasterType,
    master: StagedBlob,
    wave_peaks: StagedBlob,
    raw: PathBuf,
}

impl StemFiles {
    pub(crate) fn create(area: &Path, blobs_path: &Path, stem: MasterType) -> Self {
        Self {
            stem,
            master: stage_blob(area, blobs_path),
            wave_peaks: stage_blob(area, blobs_path),
            raw: area.join(format!("{}.{RAW_SUFFIX}", stem.name())),
        }
    }

    pub(crate) fn master_path(&self) -> &Path {
        self.master.path()
    }

    pub(crate) fn sink_stem(&self) -> SinkStem {
        SinkStem {
            name: self.stem.name(),
            raw: self.raw.clone(),
        }
    }

    pub(crate) fn staged(&self) -> Vec<&StagedBlob> {
        vec![&self.master, &self.wave_peaks]
    }

    pub(crate) fn recorded(&self) -> NewStem {
        NewStem {
            stem: self.stem,
            master_blob_id: self.master.blob_id().to_owned(),
            wave_blob_id: self.wave_peaks.blob_id().to_owned(),
        }
    }

    pub(crate) async fn encode(&self, rates: SampleRates, scale: f64) -> Result<(), BoxedError> {
        encode_flac_from_raw(&self.raw, self.master.path(), rates, scale).await
    }

    pub(crate) async fn write_peaks(
        &self,
        pcm: &dyn PcmSource,
        sample_rate: u32,
    ) -> Result<(), BoxedError> {
        let master = self.master.path();
        let request = WavePeaks {
            source: read_at(master, sample_rate),
            to: self.wave_peaks.path(),
            total_frames: read_frame_count(master).await?,
        };
        generate_wave_peaks(pcm, &request).await
    }
}

pub(crate) fn read_at(from: &Path, sample_rate: u32) -> PcmRequest<'_> {
    PcmRequest { from, sample_rate }
}
