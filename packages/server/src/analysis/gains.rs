use musetric_db::{MasterType, StemLoudness};
use musetric_media::{LeadVisualLoudness, Loudness};

const SOURCE_TARGET_LUFS: f64 = -16.0;
const SOURCE_TRUE_PEAK_CEILING_DB: f64 = -1.0;
const SOURCE_GAIN_MINIMUM_DB: f64 = -12.0;
const SOURCE_GAIN_MAXIMUM_DB: f64 = 18.0;

const PRACTICE_VOCAL_RATIO_DB: f64 = 5.0;
const SILENT_STEM_LUFS: f64 = -40.0;
const STEM_GAIN_MINIMUM_DB: f64 = -12.0;
const STEM_GAIN_MAXIMUM_DB: f64 = 12.0;

const LEAD_VISUAL_TARGET_P95_RMS_DB: f64 = -22.0;
const LEAD_VISUAL_PEAK_CEILING_DB: f64 = 3.0;
const LEAD_VISUAL_GAIN_MINIMUM_DB: f64 = -12.0;
const LEAD_VISUAL_GAIN_MAXIMUM_DB: f64 = 48.0;

pub(crate) struct Stems {
    pub(crate) lead: LeadVisualLoudness,
    pub(crate) backing: Loudness,
    pub(crate) instrumental: Loudness,
}

pub(crate) fn measure(source: Loudness, stems: &Stems) -> Vec<StemLoudness> {
    vec![
        plain(MasterType::Source, source),
        StemLoudness {
            stem: MasterType::Lead,
            integrated_lufs: stems.lead.loudness.integrated_loudness_db,
            true_peak_db: stems.lead.loudness.true_peak_db,
            p95_rms_db: Some(stems.lead.p95_rms_db),
        },
        plain(MasterType::Backing, stems.backing),
        plain(MasterType::Instrumental, stems.instrumental),
    ]
}

fn plain(stem: MasterType, loudness: Loudness) -> StemLoudness {
    StemLoudness {
        stem,
        integrated_lufs: loudness.integrated_loudness_db,
        true_peak_db: loudness.true_peak_db,
        p95_rms_db: None,
    }
}

pub(crate) struct Gains {
    pub(crate) source: f64,
    pub(crate) lead_spectrogram: f64,
    pub(crate) lead: f64,
    pub(crate) backing: f64,
    pub(crate) instrumental: f64,
}

pub(crate) fn read_gains(measured: &[StemLoudness]) -> Option<Gains> {
    let find = |stem: MasterType| measured.iter().find(|row| row.stem == stem);
    let source = find(MasterType::Source)?;
    let lead = find(MasterType::Lead)?;
    let backing = find(MasterType::Backing)?;
    let instrumental = find(MasterType::Instrumental)?;
    let source_gain_db = source_gain(source);
    let practice = practice_gains(source_gain_db, lead, backing, instrumental);
    Some(Gains {
        source: source_gain_db,
        lead_spectrogram: lead_spectrogram_gain(lead)?,
        lead: practice.lead,
        backing: practice.backing,
        instrumental: practice.instrumental,
    })
}

fn source_gain(source: &StemLoudness) -> f64 {
    let wanted = (SOURCE_TARGET_LUFS - source.integrated_lufs)
        .min(SOURCE_TRUE_PEAK_CEILING_DB - source.true_peak_db);
    wanted.clamp(SOURCE_GAIN_MINIMUM_DB, SOURCE_GAIN_MAXIMUM_DB)
}

fn lead_spectrogram_gain(lead: &StemLoudness) -> Option<f64> {
    let wanted = (LEAD_VISUAL_TARGET_P95_RMS_DB - lead.p95_rms_db?)
        .clamp(LEAD_VISUAL_GAIN_MINIMUM_DB, LEAD_VISUAL_GAIN_MAXIMUM_DB);
    Some(wanted.min(LEAD_VISUAL_PEAK_CEILING_DB - lead.true_peak_db))
}

struct PracticeGains {
    lead: f64,
    backing: f64,
    instrumental: f64,
}

fn practice_gains(
    source_gain_db: f64,
    lead: &StemLoudness,
    backing: &StemLoudness,
    instrumental: &StemLoudness,
) -> PracticeGains {
    if lead.integrated_lufs < SILENT_STEM_LUFS {
        return PracticeGains {
            lead: source_gain_db,
            backing: source_gain_db,
            instrumental: source_gain_db,
        };
    }
    let backing_target_lufs = SOURCE_TARGET_LUFS - PRACTICE_VOCAL_RATIO_DB;
    PracticeGains {
        lead: stem_gain(SOURCE_TARGET_LUFS - lead.integrated_lufs),
        backing: stem_gain(backing_target_lufs - backing.integrated_lufs),
        instrumental: stem_gain(backing_target_lufs - instrumental.integrated_lufs),
    }
}

fn stem_gain(wanted: f64) -> f64 {
    wanted.clamp(STEM_GAIN_MINIMUM_DB, STEM_GAIN_MAXIMUM_DB)
}
