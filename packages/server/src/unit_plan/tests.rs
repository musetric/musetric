use super::{PlanRules, PlanUnit, UnitPlan};

const CHUNK: u32 = 484_659;
const STEP: u64 = 352_800;
const SAMPLE_RATE: u32 = 44_100;

#[test]
fn keeps_the_declared_rules_version() {
    let plan = UnitPlan::vocals(SAMPLE_RATE, STEP);
    assert_eq!(plan.rules, PlanRules::VocalsV1);
    assert_eq!(plan.channels, 2);
    assert_eq!(plan.chunk_samples, CHUNK);
}

#[test]
fn covers_a_track_shorter_than_one_window_once() {
    let plan = UnitPlan::vocals(SAMPLE_RATE, 1_000);
    assert_eq!(plan.units().len(), 1);
    assert_eq!(plan.units()[0].start, 0);
    assert_eq!(plan.units()[0].length, 1_000);
}

#[test]
fn covers_exactly_one_window_without_a_shift() {
    let plan = UnitPlan::vocals(SAMPLE_RATE, u64::from(CHUNK));
    assert_eq!(plan.units().len(), 2);
    for unit in plan.units() {
        assert_eq!(unit.start, 0);
        assert_eq!(unit.length, CHUNK);
    }
}

#[test]
fn shifts_the_last_window_back_by_one_frame() {
    let plan = UnitPlan::vocals(SAMPLE_RATE, u64::from(CHUNK) + 1);
    assert_eq!(plan.units().len(), 2);
    assert_eq!(plan.units()[0].start, 0);
    assert_eq!(plan.units()[0].length, CHUNK);
    assert_eq!(plan.units()[1].start, 1);
    assert_eq!(plan.units()[1].length, CHUNK);
}

#[test]
#[expect(clippy::cast_possible_truncation, reason = "the step fits u32")]
fn stops_on_a_step_boundary() {
    let plan = UnitPlan::vocals(SAMPLE_RATE, STEP);
    assert_eq!(plan.units().len(), 1);
    assert_eq!(plan.units()[0].length, STEP as u32);
}

#[test]
#[expect(clippy::cast_possible_truncation, reason = "the short track fits u32")]
fn repeats_the_window_on_a_short_track() {
    let samples = 400_000;
    let plan = UnitPlan::vocals(SAMPLE_RATE, samples);
    assert_eq!(plan.units().len(), 2);
    for unit in plan.units() {
        assert_eq!(unit.start, 0);
        assert_eq!(unit.length, samples as u32);
    }
}

#[test]
fn repeats_the_shifted_last_window_until_the_track_ends() {
    let samples = 805_600;
    let plan = UnitPlan::vocals(SAMPLE_RATE, samples);
    assert_eq!(plan.units().len(), 3);
    assert_eq!(plan.units()[0].start, 0);
    assert_eq!(plan.units()[0].length, CHUNK);
    for unit in &plan.units()[1..] {
        assert_eq!(unit.start, samples - u64::from(CHUNK));
        assert_eq!(unit.length, CHUNK);
    }
}

#[test]
fn counts_units_like_the_previous_browser_loop() {
    for samples in [1_000_u64, STEP, STEP + 1, u64::from(CHUNK), 793_800 * 2 + 7] {
        let plan = UnitPlan::vocals(SAMPLE_RATE, samples);
        let counted = samples.div_ceil(STEP);
        assert_eq!(u64::from(plan.unit_count()), counted, "samples: {samples}");
    }
}

#[test]
fn weighs_the_hamming_window_over_the_whole_chunk() {
    let plan = UnitPlan::vocals(SAMPLE_RATE, 793_800 * 2);
    assert!((f64::from(plan.weight(0, 0)) - 0.08).abs() < 1e-6);
    let middle = f64::from(plan.weight(0, CHUNK / 2));
    assert!((middle - 1.0).abs() < 1e-3);
    let last = f64::from(plan.weight(0, CHUNK - 1));
    assert!(last > 0.04 && last < 0.081);
}

#[test]
fn weighs_a_short_window_by_the_full_period() {
    let plan = UnitPlan::vocals(SAMPLE_RATE, 1_000);
    let first = f64::from(plan.weight(0, 1));
    let expected = 0.54 - 0.46 * (std::f64::consts::TAU / f64::from(CHUNK)).cos();
    assert!((first - expected).abs() < 1e-6);
}

#[test]
#[expect(
    clippy::cast_precision_loss,
    reason = "window positions are small integers"
)]
fn pads_the_window_with_silence_after_the_useful_input() {
    let plan = UnitPlan::create(
        PlanRules::VocalsV1,
        2,
        8,
        vec![PlanUnit {
            start: 4,
            length: 4,
        }],
    );
    let frames = 8_usize;
    let mut input = vec![0.0_f32; 2 * frames];
    for (index, value) in input.iter_mut().enumerate() {
        *value = index as f32;
    }
    let bytes = plan.window_bytes(&input, 0);
    let window: Vec<f32> = bytes
        .chunks_exact(4)
        .map(|raw| f32::from_le_bytes(raw.try_into().expect("four bytes")))
        .collect();
    assert_eq!(window.len(), 16);
    for channel in 0..2 {
        let base = channel * 8;
        assert_eq!(
            window[base..base + 4],
            input[channel * frames + 4..channel * frames + 8]
        );
        assert_eq!(window[base + 4..base + 8], vec![0.0; 4]);
    }
}

const KARA_CHUNK: u32 = 261_120;
const KARA_STEP: u64 = 195_840;
const KARA_TRIM: u32 = 2_560;
const KARA_GEN: u64 = 256_000;

#[test]
fn keeps_the_lead_backing_rules_version() {
    let (plan, _) = UnitPlan::lead_backing(KARA_GEN);
    assert_eq!(plan.rules, PlanRules::LeadBackingV1);
    assert_eq!(plan.channels, 2);
    assert_eq!(plan.chunk_samples, KARA_CHUNK);
}

#[test]
fn pads_the_mixture_by_the_declared_geometry() {
    let samples = KARA_GEN;
    let (plan, layout) = UnitPlan::lead_backing(samples);
    assert_eq!(layout.trim, KARA_TRIM);
    assert_eq!(
        layout.mixture_samples,
        2 * u64::from(KARA_TRIM) + samples + KARA_GEN - samples % KARA_GEN
    );
    assert_eq!(plan.chunk_samples, KARA_CHUNK);

    let shorter = 100_000_u64;
    let (_, short_layout) = UnitPlan::lead_backing(shorter);
    assert_eq!(
        short_layout.mixture_samples,
        2 * u64::from(KARA_TRIM) + shorter + KARA_GEN - shorter % KARA_GEN
    );
}

#[test]
#[expect(clippy::cast_possible_truncation, reason = "the tail fits u32")]
fn gives_the_last_lead_backing_window_a_shorter_tail() {
    let samples = KARA_GEN;
    let (plan, layout) = UnitPlan::lead_backing(samples);
    assert_eq!(plan.units().len(), 3);
    assert_eq!(plan.units()[0].start, 0);
    assert_eq!(plan.units()[0].length, KARA_CHUNK);
    assert_eq!(plan.units()[1].start, KARA_STEP);
    assert_eq!(plan.units()[2].start, 2 * KARA_STEP);
    let tail = layout.mixture_samples - 2 * KARA_STEP;
    assert_eq!(plan.units()[2].length, tail as u32);
    assert_eq!(
        u64::from(plan.unit_count()),
        layout.mixture_samples.div_ceil(KARA_STEP)
    );
}

#[test]
fn weighs_the_lead_backing_window_symmetrically() {
    let samples = KARA_GEN;
    let (plan, layout) = UnitPlan::lead_backing(samples);
    let last = plan.units().len() - 1;
    assert!(plan.weight(0, 0).abs() < 1e-7);
    assert!(plan.weight(0, KARA_CHUNK - 1).abs() < 1e-6);
    let tail = plan.units()[last].length;
    let first_tail = f64::from(plan.weight(last, 1));
    let expected = 0.5 - 0.5 * (std::f64::consts::TAU / f64::from(tail - 1)).cos();
    assert!((first_tail - expected).abs() < 1e-6);
    assert!(f64::from(plan.weight(last, 0)).abs() < 1e-7);
    let _ = layout;
}
