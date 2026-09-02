use musetric_db::NewAudioAnalysis;
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

pub(crate) fn measure(source: Loudness, stems: &Stems) -> NewAudioAnalysis {
    let source_gain_db = source_gain(source);
    let practice = practice_gains(source_gain_db, stems);
    NewAudioAnalysis {
        source_integrated_loudness_db: source.integrated_loudness_db,
        source_true_peak_db: source.true_peak_db,
        source_gain_db,
        lead_integrated_loudness_db: stems.lead.loudness.integrated_loudness_db,
        lead_true_peak_db: stems.lead.loudness.true_peak_db,
        lead_p95_rms_db: stems.lead.p95_rms_db,
        lead_spectrogram_gain_db: lead_spectrogram_gain(&stems.lead),
        backing_integrated_loudness_db: stems.backing.integrated_loudness_db,
        backing_true_peak_db: stems.backing.true_peak_db,
        instrumental_integrated_loudness_db: stems.instrumental.integrated_loudness_db,
        instrumental_true_peak_db: stems.instrumental.true_peak_db,
        lead_gain_db: practice.lead,
        backing_gain_db: practice.backing,
        instrumental_gain_db: practice.instrumental,
    }
}

fn source_gain(source: Loudness) -> f64 {
    let wanted = (SOURCE_TARGET_LUFS - source.integrated_loudness_db)
        .min(SOURCE_TRUE_PEAK_CEILING_DB - source.true_peak_db);
    wanted.clamp(SOURCE_GAIN_MINIMUM_DB, SOURCE_GAIN_MAXIMUM_DB)
}

fn lead_spectrogram_gain(lead: &LeadVisualLoudness) -> f64 {
    let wanted = (LEAD_VISUAL_TARGET_P95_RMS_DB - lead.p95_rms_db)
        .clamp(LEAD_VISUAL_GAIN_MINIMUM_DB, LEAD_VISUAL_GAIN_MAXIMUM_DB);
    wanted.min(LEAD_VISUAL_PEAK_CEILING_DB - lead.loudness.true_peak_db)
}

struct PracticeGains {
    lead: f64,
    backing: f64,
    instrumental: f64,
}

fn practice_gains(source_gain_db: f64, stems: &Stems) -> PracticeGains {
    let lead_loudness_db = stems.lead.loudness.integrated_loudness_db;
    if lead_loudness_db < SILENT_STEM_LUFS {
        return PracticeGains {
            lead: source_gain_db,
            backing: source_gain_db,
            instrumental: source_gain_db,
        };
    }
    let backing_target_lufs = SOURCE_TARGET_LUFS - PRACTICE_VOCAL_RATIO_DB;
    PracticeGains {
        lead: stem_gain(SOURCE_TARGET_LUFS - lead_loudness_db),
        backing: stem_gain(backing_target_lufs - stems.backing.integrated_loudness_db),
        instrumental: stem_gain(backing_target_lufs - stems.instrumental.integrated_loudness_db),
    }
}

fn stem_gain(wanted: f64) -> f64 {
    wanted.clamp(STEM_GAIN_MINIMUM_DB, STEM_GAIN_MAXIMUM_DB)
}
