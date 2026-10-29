use super::{PlanChannels, PlanRules, PlanUnit, UnitPlan};

const CHUNK: u32 = 484_659;
const STEP: u64 = 352_800;
const SAMPLE_RATE: u32 = 44_100;
const STEREO_STEMS: PlanChannels = PlanChannels {
    input: 2,
    output: 4,
};

#[test]
fn keeps_the_declared_rules_version() {
    let plan = UnitPlan::vocals(SAMPLE_RATE, STEP);
    assert_eq!(plan.rules, PlanRules::VocalsV1);
    assert_eq!(plan.channels, STEREO_STEMS);
    assert_eq!(plan.chunk_samples, CHUNK);
}

#[test]
fn takes_a_stereo_window_and_expects_the_vocals_and_the_backing_back() {
    let plan = UnitPlan::vocals(SAMPLE_RATE, STEP);
    assert_eq!(
        plan.window_bytes(&vec![0.0; 2 * 352_800], 0).len(),
        2 * 4 * 484_659
    );
    assert_eq!(plan.output_bytes(), 4 * 4 * u64::from(CHUNK));
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
        STEREO_STEMS,
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
        .as_chunks::<4>()
        .0
        .iter()
        .map(|raw| f32::from_le_bytes(*raw))
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

#[test]
fn settles_the_frames_no_remaining_window_can_touch() {
    let plan = UnitPlan::create(
        PlanRules::VocalsV1,
        STEREO_STEMS,
        5,
        [0, 3, 6, 9, 7]
            .into_iter()
            .map(|start| PlanUnit { start, length: 5 })
            .collect(),
    );
    assert_eq!(plan.settled_frames(0, 12), 0);
    assert_eq!(plan.settled_frames(2, 12), 6);
    assert_eq!(plan.settled_frames(3, 12), 7);
    assert_eq!(plan.settled_frames(5, 12), 12);
    assert_eq!(plan.reached_frames(0, 12), 0);
    assert_eq!(plan.reached_frames(2, 12), 8);
    assert_eq!(plan.reached_frames(4, 12), 12);
}
