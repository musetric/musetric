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

    #[cfg(test)]
    pub(crate) fn raw_path(&self) -> &Path {
        &self.raw
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

#[cfg(test)]
mod tests {
    use std::path::Path;

    use musetric_db::MasterType;

    use super::{RAW_SUFFIX, StemFiles};

    #[test]
    fn stores_every_stem_next_to_the_master_it_encodes() {
        let area = Path::new("/work/1/separation");
        let stems = [
            StemFiles::create(area, Path::new("/blobs"), MasterType::Lead),
            StemFiles::create(area, Path::new("/blobs"), MasterType::Instrumental),
        ];

        for stem in &stems {
            let name = stem.recorded().stem.name();
            assert_eq!(stem.raw_path(), area.join(format!("{name}.{RAW_SUFFIX}")));
            assert_eq!(
                stem.master_path(),
                area.join(stem.recorded().master_blob_id)
            );
        }
    }

    #[test]
    fn stages_the_master_and_its_peaks_under_the_ids_it_records() {
        let area = Path::new("/work/1/separation");
        let stem = StemFiles::create(area, Path::new("/blobs"), MasterType::Backing);
        let recorded = stem.recorded();

        let staged: Vec<_> = stem.staged().iter().map(|blob| blob.blob_id()).collect();

        assert_eq!(
            staged,
            [
                recorded.master_blob_id.as_str(),
                recorded.wave_blob_id.as_str()
            ]
        );
    }
}
