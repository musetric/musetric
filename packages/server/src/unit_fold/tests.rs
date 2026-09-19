use super::FoldAccumulator;
use crate::unit_plan::{PlanRules, PlanUnit, UnitPlan};

fn stereo(chunk: &[f32]) -> Vec<f32> {
    let channel: Vec<f32> = chunk.to_vec();
    [channel.clone(), channel].concat()
}

fn is_close(found: f32, expected: f64) -> bool {
    (f64::from(found) - expected).abs() < 1e-6
}

#[test]
fn divides_the_sum_by_the_window_counter() {
    let plan = UnitPlan::create(
        PlanRules::LeadBackingV1,
        2,
        4,
        vec![PlanUnit {
            start: 0,
            length: 4,
        }],
    );
    let mut fold = FoldAccumulator::create(4, 2);
    fold.add(&plan, 0, &stereo(&[1.0, 0.5, -0.25, 2.0]));

    let finalized = fold.finalize();
    assert!(is_close(finalized[0], 0.0));
    assert!(is_close(finalized[1], 0.5));
    assert!(is_close(finalized[2], -0.25));
    assert!(is_close(finalized[3], 0.0));
    assert!(is_close(finalized[4], finalized[0].into()));
    assert!(is_close(finalized[5], finalized[1].into()));
}

#[test]
fn sums_overlapping_windows_once_each() {
    let plan = UnitPlan::create(
        PlanRules::LeadBackingV1,
        2,
        4,
        vec![
            PlanUnit {
                start: 0,
                length: 4,
            },
            PlanUnit {
                start: 2,
                length: 4,
            },
        ],
    );
    let mut fold = FoldAccumulator::create(6, 2);
    fold.add(&plan, 0, &stereo(&[1.0, 1.0, 1.0, 1.0]));
    fold.add(&plan, 1, &stereo(&[0.5, 0.5, 0.5, 0.5]));

    let finalized = fold.finalize();
    assert!(is_close(finalized[0], 0.0));
    assert!(is_close(finalized[1], 1.0));
    assert!(is_close(finalized[2], 1.0));
    assert!(is_close(finalized[3], 0.5));
    assert!(is_close(finalized[4], 0.5));
    assert!(is_close(finalized[5], 0.0));
}

#[test]
fn treats_positions_outside_every_window_as_silence() {
    let plan = UnitPlan::create(
        PlanRules::LeadBackingV1,
        2,
        2,
        vec![PlanUnit {
            start: 0,
            length: 2,
        }],
    );
    let mut fold = FoldAccumulator::create(4, 2);
    fold.add(&plan, 0, &stereo(&[3.0, 4.0]));

    let finalized = fold.finalize();
    assert!(is_close(finalized[2], 0.0));
    assert!(is_close(finalized[3], 0.0));
    assert!(is_close(finalized[0], 0.0));
}

#[test]
fn repeats_the_same_summation_for_the_same_input() {
    let plan = UnitPlan::create(
        PlanRules::LeadBackingV1,
        2,
        4,
        vec![PlanUnit {
            start: 0,
            length: 4,
        }],
    );
    let chunk = stereo(&[0.25, -0.5, 0.125, -0.125]);
    let mut first = FoldAccumulator::create(4, 2);
    first.add(&plan, 0, &chunk);
    let mut again = FoldAccumulator::create(4, 2);
    again.add(&plan, 0, &chunk);
    assert_eq!(
        first
            .finalize()
            .iter()
            .map(|value| value.to_bits())
            .collect::<Vec<_>>(),
        again
            .finalize()
            .iter()
            .map(|value| value.to_bits())
            .collect::<Vec<_>>()
    );
}

fn chunk_for(unit: usize, frames: u32) -> Vec<f32> {
    let channel: Vec<f32> = (0..frames)
        .map(|position| {
            let seed = u32::try_from(unit).unwrap_or(0) * 31 + position * 7;
            f32::from(u16::try_from(seed % 97).unwrap_or(0)) / 97.0 - 0.5
        })
        .collect();
    stereo(&channel)
}

fn plan_with(starts: &[u64], length: u32) -> UnitPlan {
    UnitPlan::create(
        PlanRules::LeadBackingV1,
        2,
        length,
        starts
            .iter()
            .map(|&start| PlanUnit { start, length })
            .collect(),
    )
}

fn bits(values: &[f32]) -> Vec<u32> {
    values.iter().map(|value| value.to_bits()).collect()
}

fn resumed_every(plan: &UnitPlan, frames: u64, every: usize) -> (Vec<f32>, usize) {
    let count = plan.units().len();
    let mut fold = FoldAccumulator::create(frames, 2);
    let mut prefix_file: Vec<u8> = Vec::new();
    let mut committed = 0_u64;
    let mut largest_write = 0;
    let mut next = 0;
    while next < count {
        fold.add(plan, next, &chunk_for(next, plan.chunk_samples));
        next += 1;
        if next != count && next % every != 0 {
            continue;
        }
        let settled = plan.settled_frames(next, frames);
        let reached = plan.reached_frames(next, frames).max(settled);
        let appended = fold.records(committed, settled);
        let tail = fold.records(settled, reached);
        largest_write = largest_write.max(appended.len() + tail.len());
        prefix_file.truncate(usize::try_from(committed).unwrap_or(0) * fold.record_bytes());
        prefix_file.extend_from_slice(&appended);
        prefix_file.extend_from_slice(b"unconfirmed");
        committed = settled;
        let confirmed = &prefix_file[..usize::try_from(settled).unwrap_or(0) * fold.record_bytes()];
        fold = FoldAccumulator::restore(frames, 2, confirmed, &tail)
            .expect("the checkpoint should restore");
    }
    (fold.finalize(), largest_write)
}

#[test]
fn resumes_to_the_same_bits_as_a_fold_that_never_stopped() {
    let plans = [
        (plan_with(&[0, 3, 6, 9, 7], 5), 14),
        (plan_with(&[0, 0, 0], 5), 5),
        (plan_with(&[0, 2, 4, 6, 8, 10, 12], 4), 16),
    ];
    for (plan, frames) in plans {
        let mut continuous = FoldAccumulator::create(frames, 2);
        for index in 0..plan.units().len() {
            continuous.add(&plan, index, &chunk_for(index, plan.chunk_samples));
        }
        for every in [1, 2, 3] {
            let (resumed, _) = resumed_every(&plan, frames, every);
            assert_eq!(bits(&resumed), bits(&continuous.finalize()));
        }
    }
}

#[test]
fn writes_a_bounded_checkpoint_whatever_the_track_length() {
    let short: Vec<u64> = (0..20).map(|unit| unit * 3).collect();
    let long: Vec<u64> = (0..200).map(|unit| unit * 3).collect();
    let (_, short_write) = resumed_every(&plan_with(&short, 5), 62, 2);
    let (_, long_write) = resumed_every(&plan_with(&long, 5), 602, 2);
    assert_eq!(short_write, long_write);
}

#[test]
fn refuses_records_that_do_not_fit_the_fold() {
    let fold = FoldAccumulator::create(4, 2);
    let prefix = fold.records(0, 2);
    let tail = fold.records(2, 4);
    assert!(FoldAccumulator::restore(4, 2, &prefix, &tail).is_some());
    assert!(FoldAccumulator::restore(4, 2, &prefix[..3], &tail).is_none());
    assert!(FoldAccumulator::restore(4, 2, &prefix, &fold.records(0, 4)).is_none());
}

#[test]
fn encodes_a_record_as_targets_then_counters_in_little_endian() {
    let mut fold = FoldAccumulator::create(1, 1);
    fold.target[0] = 1.0;
    fold.counter[0] = 2.0;
    assert_eq!(fold.records(0, 1), vec![0, 0, 128, 63, 0, 0, 0, 64]);
}
