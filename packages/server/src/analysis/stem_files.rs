use std::path::{Path, PathBuf};

use musetric_db::{MasterType, NewDelivery, NewStem};
use musetric_media::{
    BoxedError, PcmRequest, PcmSource, SampleRates, WavePeaks, convert_to_fmp4,
    encode_flac_from_raw, generate_wave_peaks, read_frame_count,
};
use tokio::fs;

use crate::{
    analysis::{browser::Failure, stem_signal::interleaved_from_planar},
    blobs::{StagedBlob, stage_blob},
};

const RAW_SUFFIX: &str = "raw";

struct Delivered {
    media: StagedBlob,
    wave_peaks: StagedBlob,
}

pub(crate) struct StemFiles {
    stem: MasterType,
    master: StagedBlob,
    raw: PathBuf,
    delivered: Option<Delivered>,
}

impl StemFiles {
    pub(crate) fn master(area: &Path, blobs_path: &Path, stem: MasterType) -> Self {
        Self {
            stem,
            master: stage_blob(area, blobs_path),
            raw: area.join(format!("{}.{RAW_SUFFIX}", stem.name())),
            delivered: None,
        }
    }

    pub(crate) fn delivered(area: &Path, blobs_path: &Path, stem: MasterType) -> Self {
        Self {
            delivered: Some(Delivered {
                media: stage_blob(area, blobs_path),
                wave_peaks: stage_blob(area, blobs_path),
            }),
            ..Self::master(area, blobs_path, stem)
        }
    }

    pub(crate) fn master_path(&self) -> &Path {
        self.master.path()
    }

    #[cfg(test)]
    pub(crate) fn raw_path(&self) -> &Path {
        &self.raw
    }

    pub(crate) fn staged(&self) -> Vec<&StagedBlob> {
        let mut blobs = vec![&self.master];
        if let Some(delivered) = self.delivered.as_ref() {
            blobs.push(&delivered.media);
            blobs.push(&delivered.wave_peaks);
        }
        blobs
    }

    pub(crate) fn recorded(&self) -> NewStem {
        NewStem {
            stem: self.stem,
            master_blob_id: self.master.blob_id().to_owned(),
            delivery: self.delivered.as_ref().map(|delivered| NewDelivery {
                blob_id: delivered.media.blob_id().to_owned(),
                wave_blob_id: delivered.wave_peaks.blob_id().to_owned(),
            }),
        }
    }

    pub(crate) async fn write_raw(&self, planar: &[f32]) -> Result<(), Failure> {
        if let Some(directory) = self.raw.parent() {
            fs::create_dir_all(directory)
                .await
                .map_err(|error| Failure::from(error.to_string()))?;
        }
        fs::write(&self.raw, interleaved_from_planar(planar))
            .await
            .map_err(|error| Failure::from(error.to_string()))
    }

    pub(crate) async fn encode(&self, rates: SampleRates) -> Result<(), BoxedError> {
        encode_flac_from_raw(&self.raw, self.master.path(), rates).await
    }

    pub(crate) async fn deliver(
        &self,
        pcm: &dyn PcmSource,
        sample_rate: u32,
    ) -> Result<(), BoxedError> {
        let Some(delivered) = self.delivered.as_ref() else {
            return Ok(());
        };
        let master = self.master.path();
        convert_to_fmp4(pcm, read_at(master, sample_rate), delivered.media.path()).await?;
        let request = WavePeaks {
            source: read_at(master, sample_rate),
            to: delivered.wave_peaks.path(),
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
            StemFiles::master(area, Path::new("/blobs"), MasterType::Vocals),
            StemFiles::delivered(area, Path::new("/blobs"), MasterType::Instrumental),
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
    fn keeps_an_internal_master_out_of_the_delivery_table() {
        let area = Path::new("/work/1/separation");
        let vocals = StemFiles::master(area, Path::new("/blobs"), MasterType::Vocals);
        let instrumental =
            StemFiles::delivered(area, Path::new("/blobs"), MasterType::Instrumental);

        assert_eq!(vocals.staged().len(), 1);
        assert!(vocals.recorded().delivery.is_none());
        assert_eq!(instrumental.staged().len(), 3);
        assert!(instrumental.recorded().delivery.is_some());
    }
}
