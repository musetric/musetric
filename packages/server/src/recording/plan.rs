use musetric_db::{RecordingLayer, RecordingPiece};

const TEMPO_TOLERANCE: f64 = 1e-9;
const TOUCH_TOLERANCE_FRAMES: f64 = 1.0;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct SourceRange {
    pub(crate) blob_id: String,
    pub(crate) start_frame: i64,
    pub(crate) frame_count: i64,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct PlannedPiece {
    pub(crate) sources: Vec<SourceRange>,
    pub(crate) song_start_frame: i64,
    pub(crate) frame_count: i64,
    pub(crate) tempo: f64,
}

impl PlannedPiece {
    fn whole(piece: &RecordingPiece) -> Self {
        Self {
            sources: vec![SourceRange {
                blob_id: piece.blob_id.clone(),
                start_frame: 0,
                frame_count: piece.frame_count,
            }],
            song_start_frame: piece.song_start_frame,
            frame_count: piece.frame_count,
            tempo: piece.tempo,
        }
    }

    fn part(&self, start_frame: i64, frame_count: i64) -> Self {
        let end_frame = start_frame + frame_count;
        let mut sources = Vec::new();
        let mut source_start = 0;
        for source in &self.sources {
            let from = start_frame.max(source_start);
            let to = end_frame.min(source_start + source.frame_count);
            if to > from {
                sources.push(SourceRange {
                    blob_id: source.blob_id.clone(),
                    start_frame: source.start_frame + from - source_start,
                    frame_count: to - from,
                });
            }
            source_start += source.frame_count;
        }
        Self {
            sources,
            song_start_frame: round_frame(song_frame(
                self.song_start_frame,
                start_frame,
                self.tempo,
            )),
            frame_count,
            tempo: self.tempo,
        }
    }

    pub(crate) fn reused_blob<'piece>(
        &self,
        pieces: &'piece [RecordingPiece],
    ) -> Option<&'piece str> {
        let [source] = self.sources.as_slice() else {
            return None;
        };
        pieces
            .iter()
            .find(|piece| {
                piece.blob_id == source.blob_id
                    && source.start_frame == 0
                    && source.frame_count == piece.frame_count
            })
            .map(|piece| piece.blob_id.as_str())
    }

    fn song_start(&self) -> f64 {
        song_frame(self.song_start_frame, 0, self.tempo)
    }

    fn song_end(&self) -> f64 {
        song_frame(self.song_start_frame, self.frame_count, self.tempo)
    }

    #[expect(
        clippy::cast_precision_loss,
        reason = "frame positions stay far below 2^53"
    )]
    fn recorded_frame(&self, song_frame_position: f64) -> i64 {
        let offset = (song_frame_position - self.song_start_frame as f64) / self.tempo;
        round_frame(offset).clamp(0, self.frame_count)
    }
}

#[expect(
    clippy::cast_precision_loss,
    reason = "frame positions stay far below 2^53"
)]
fn song_frame(song_start_frame: i64, recorded_frame: i64, tempo: f64) -> f64 {
    song_start_frame as f64 + recorded_frame as f64 * tempo
}

#[expect(
    clippy::cast_possible_truncation,
    reason = "a rounded frame position stays far inside the i64 range"
)]
fn round_frame(frame: f64) -> i64 {
    frame.round() as i64
}

fn cut_around(piece: PlannedPiece, top: &PlannedPiece) -> Vec<PlannedPiece> {
    let (top_start, top_end) = (top.song_start(), top.song_end());
    if piece.song_end() <= top_start || piece.song_start() >= top_end {
        return vec![piece];
    }
    let mut parts = Vec::new();
    let left_count = piece.recorded_frame(top_start);
    if left_count > 0 {
        parts.push(piece.part(0, left_count));
    }
    let right_start = piece.recorded_frame(top_end);
    if right_start < piece.frame_count {
        parts.push(piece.part(right_start, piece.frame_count - right_start));
    }
    parts
}

fn cut_under(pieces: Vec<PlannedPiece>, top: &PlannedPiece) -> Vec<PlannedPiece> {
    pieces
        .into_iter()
        .flat_map(|piece| cut_around(piece, top))
        .collect()
}

fn touches(previous: &PlannedPiece, next: &PlannedPiece) -> bool {
    (previous.tempo - next.tempo).abs() < TEMPO_TOLERANCE
        && (previous.song_end() - next.song_start()).abs() < TOUCH_TOLERANCE_FRAMES
}

fn coalesce(mut pieces: Vec<PlannedPiece>) -> Vec<PlannedPiece> {
    pieces.sort_by_key(|piece| piece.song_start_frame);
    let mut merged: Vec<PlannedPiece> = Vec::with_capacity(pieces.len());
    for piece in pieces {
        match merged.last_mut() {
            Some(previous) if touches(previous, &piece) => {
                previous.frame_count += piece.frame_count;
                previous.sources.extend(piece.sources);
            }
            _ => merged.push(piece),
        }
    }
    merged
}

pub(crate) fn plan_take(runs: &[RecordingPiece]) -> Vec<PlannedPiece> {
    let mut pieces = Vec::new();
    for run in runs {
        let top = PlannedPiece::whole(run);
        pieces = cut_under(pieces, &top);
        pieces.push(top);
    }
    coalesce(pieces)
}

pub(crate) fn merge_fresh(base: &[RecordingPiece], fresh: &[RecordingPiece]) -> Vec<PlannedPiece> {
    let tops: Vec<PlannedPiece> = fresh.iter().map(PlannedPiece::whole).collect();
    let mut pieces = keep_base(base);
    for top in &tops {
        pieces = cut_under(pieces, top);
    }
    pieces.extend(tops);
    coalesce(pieces)
}

pub(crate) fn keep_base(base: &[RecordingPiece]) -> Vec<PlannedPiece> {
    base.iter().map(PlannedPiece::whole).collect()
}

fn layer_pieces(pieces: &[RecordingPiece], layer: RecordingLayer) -> Vec<RecordingPiece> {
    pieces
        .iter()
        .filter(|piece| piece.layer == layer)
        .cloned()
        .collect()
}

pub(crate) fn base_pieces(pieces: &[RecordingPiece]) -> Vec<RecordingPiece> {
    layer_pieces(pieces, RecordingLayer::Base)
}

pub(crate) fn fresh_pieces(pieces: &[RecordingPiece]) -> Vec<RecordingPiece> {
    layer_pieces(pieces, RecordingLayer::Fresh)
}

#[cfg(test)]
mod tests {
    use musetric_db::{RecordingLayer, RecordingPiece};

    use super::{PlannedPiece, SourceRange, merge_fresh, plan_take};

    fn piece(blob_id: &str, song_start_frame: i64, frame_count: i64, tempo: f64) -> RecordingPiece {
        RecordingPiece {
            blob_id: blob_id.to_owned(),
            layer: RecordingLayer::Base,
            song_start_frame,
            frame_count,
            tempo,
        }
    }

    fn source(blob_id: &str, start_frame: i64, frame_count: i64) -> SourceRange {
        SourceRange {
            blob_id: blob_id.to_owned(),
            start_frame,
            frame_count,
        }
    }

    #[test]
    fn glues_a_same_tempo_take_into_one_piece() {
        let base = [piece("a", 0, 60, 1.0)];
        let fresh = [piece("b", 10, 30, 1.0)];

        let merged = merge_fresh(&base, &fresh);

        assert_eq!(
            merged,
            [PlannedPiece {
                sources: vec![source("a", 0, 10), source("b", 0, 30), source("a", 40, 20)],
                song_start_frame: 0,
                frame_count: 60,
                tempo: 1.0,
            }]
        );
    }

    #[test]
    fn splits_the_base_where_the_tempo_changes() {
        let base = [piece("a", 0, 60, 1.0)];
        let fresh = [piece("b", 10, 60, 0.5)];

        let merged = merge_fresh(&base, &fresh);

        assert_eq!(
            merged,
            [
                PlannedPiece {
                    sources: vec![source("a", 0, 10)],
                    song_start_frame: 0,
                    frame_count: 10,
                    tempo: 1.0,
                },
                PlannedPiece {
                    sources: vec![source("b", 0, 60)],
                    song_start_frame: 10,
                    frame_count: 60,
                    tempo: 0.5,
                },
                PlannedPiece {
                    sources: vec![source("a", 40, 20)],
                    song_start_frame: 40,
                    frame_count: 20,
                    tempo: 1.0,
                },
            ]
        );
    }

    #[test]
    fn keeps_gaps_between_pieces_apart() {
        let base = [piece("a", 0, 10, 1.0)];
        let fresh = [piece("b", 50, 10, 1.0)];

        let merged = merge_fresh(&base, &fresh);

        assert_eq!(merged.len(), 2);
        assert_eq!(merged[1].song_start_frame, 50);
    }

    #[test]
    fn keeps_a_one_frame_gap_apart() {
        let base = [piece("a", 0, 10, 1.0)];
        let fresh = [piece("b", 11, 10, 1.0)];

        let merged = merge_fresh(&base, &fresh);

        assert_eq!(merged.len(), 2);
        assert_eq!(merged[1].song_start_frame, 11);
    }

    #[test]
    fn glues_a_slow_take_that_ends_within_a_frame() {
        let base = [piece("a", 0, 21, 0.5)];
        let fresh = [piece("b", 11, 10, 0.5)];

        let merged = merge_fresh(&base, &fresh);

        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].frame_count, 31);
    }

    #[test]
    fn drops_a_piece_the_take_covers_entirely() {
        let base = [piece("a", 20, 10, 1.0), piece("c", 50, 10, 0.5)];
        let fresh = [piece("b", 0, 40, 1.0)];

        let merged = merge_fresh(&base, &fresh);

        assert_eq!(
            merged,
            [
                PlannedPiece {
                    sources: vec![source("b", 0, 40)],
                    song_start_frame: 0,
                    frame_count: 40,
                    tempo: 1.0,
                },
                PlannedPiece {
                    sources: vec![source("c", 0, 10)],
                    song_start_frame: 50,
                    frame_count: 10,
                    tempo: 0.5,
                },
            ]
        );
    }

    #[test]
    fn cuts_a_slow_piece_by_its_recorded_frames() {
        let base = [piece("a", 0, 120, 0.5)];
        let fresh = [piece("b", 20, 10, 1.0)];

        let merged = merge_fresh(&base, &fresh);

        assert_eq!(merged[0].sources, [source("a", 0, 40)]);
        assert_eq!(merged[2].sources, [source("a", 60, 60)]);
        assert_eq!(merged[2].song_start_frame, 30);
    }

    #[test]
    fn lays_every_piece_of_a_take_over_the_base() {
        let base = [piece("a", 0, 100, 1.0)];
        let fresh = [piece("b", 10, 10, 1.0), piece("c", 60, 10, 1.0)];

        let merged = merge_fresh(&base, &fresh);

        assert_eq!(
            merged,
            [PlannedPiece {
                sources: vec![
                    source("a", 0, 10),
                    source("b", 0, 10),
                    source("a", 20, 40),
                    source("c", 0, 10),
                    source("a", 70, 30),
                ],
                song_start_frame: 0,
                frame_count: 100,
                tempo: 1.0,
            }]
        );
    }

    #[test]
    fn keeps_a_single_run_whole() {
        let runs = [piece("a", 30, 50, 0.5)];

        let take = plan_take(&runs);

        assert_eq!(
            take,
            [PlannedPiece {
                sources: vec![source("a", 0, 50)],
                song_start_frame: 30,
                frame_count: 50,
                tempo: 0.5,
            }]
        );
        assert_eq!(take[0].reused_blob(&runs), Some("a"));
    }

    #[test]
    fn splits_a_take_where_a_seek_skipped_ahead() {
        let runs = [piece("a", 0, 20, 1.0), piece("b", 50, 20, 1.0)];

        let take = plan_take(&runs);

        assert_eq!(take.len(), 2);
        assert_eq!(take[0].sources, [source("a", 0, 20)]);
        assert_eq!(take[1].sources, [source("b", 0, 20)]);
        assert_eq!(take[1].song_start_frame, 50);
    }

    #[test]
    fn lets_the_last_run_win_where_runs_overlap() {
        let runs = [piece("a", 0, 100, 1.0), piece("b", 40, 30, 1.0)];

        let take = plan_take(&runs);

        assert_eq!(
            take,
            [PlannedPiece {
                sources: vec![source("a", 0, 40), source("b", 0, 30), source("a", 70, 30)],
                song_start_frame: 0,
                frame_count: 100,
                tempo: 1.0,
            }]
        );
    }

    #[test]
    fn keeps_the_tail_of_an_earlier_try_from_the_same_start() {
        let runs = [piece("a", 10, 60, 1.0), piece("b", 10, 20, 1.0)];

        let take = plan_take(&runs);

        assert_eq!(
            take,
            [PlannedPiece {
                sources: vec![source("b", 0, 20), source("a", 20, 40)],
                song_start_frame: 10,
                frame_count: 60,
                tempo: 1.0,
            }]
        );
    }

    #[test]
    fn layers_runs_in_the_order_they_were_sung() {
        let runs = [
            piece("a", 0, 40, 1.0),
            piece("b", 30, 40, 1.0),
            piece("c", 20, 20, 1.0),
        ];

        let take = plan_take(&runs);

        assert_eq!(
            take,
            [PlannedPiece {
                sources: vec![source("a", 0, 20), source("c", 0, 20), source("b", 10, 30)],
                song_start_frame: 0,
                frame_count: 70,
                tempo: 1.0,
            }]
        );
    }

    #[test]
    fn maps_slow_runs_onto_the_song() {
        let runs = [piece("a", 0, 200, 0.5), piece("b", 40, 20, 0.5)];

        let take = plan_take(&runs);

        assert_eq!(
            take,
            [PlannedPiece {
                sources: vec![
                    source("a", 0, 80),
                    source("b", 0, 20),
                    source("a", 100, 100)
                ],
                song_start_frame: 0,
                frame_count: 200,
                tempo: 0.5,
            }]
        );
    }
}
