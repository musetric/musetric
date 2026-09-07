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
