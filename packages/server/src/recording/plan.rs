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

    fn part(piece: &RecordingPiece, start_frame: i64, frame_count: i64) -> Self {
        Self {
            sources: vec![SourceRange {
                blob_id: piece.blob_id.clone(),
                start_frame,
                frame_count,
            }],
            song_start_frame: round_frame(song_frame(
                piece.song_start_frame,
                start_frame,
                piece.tempo,
            )),
            frame_count,
            tempo: piece.tempo,
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

    fn song_end(&self) -> f64 {
        song_frame(self.song_start_frame, self.frame_count, self.tempo)
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

#[expect(
    clippy::cast_precision_loss,
    reason = "frame positions stay far below 2^53"
)]
fn recorded_frame(piece: &RecordingPiece, song_frame_position: f64) -> i64 {
    let offset = (song_frame_position - piece.song_start_frame as f64) / piece.tempo;
    round_frame(offset).clamp(0, piece.frame_count)
}

fn cut_around(piece: &RecordingPiece, fresh_start: f64, fresh_end: f64) -> Vec<PlannedPiece> {
    let start = song_frame(piece.song_start_frame, 0, piece.tempo);
    let end = song_frame(piece.song_start_frame, piece.frame_count, piece.tempo);
    if end <= fresh_start || start >= fresh_end {
        return vec![PlannedPiece::whole(piece)];
    }
    let mut parts = Vec::new();
    let left_count = recorded_frame(piece, fresh_start);
    if left_count > 0 {
        parts.push(PlannedPiece::part(piece, 0, left_count));
    }
    let right_start = recorded_frame(piece, fresh_end);
    if right_start < piece.frame_count {
        parts.push(PlannedPiece::part(
            piece,
            right_start,
            piece.frame_count - right_start,
        ));
    }
    parts
}

fn touches(previous: &PlannedPiece, next: &PlannedPiece) -> bool {
    (previous.tempo - next.tempo).abs() < TEMPO_TOLERANCE
        && (previous.song_end() - song_frame(next.song_start_frame, 0, next.tempo)).abs()
            < TOUCH_TOLERANCE_FRAMES
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

pub(crate) fn merge_fresh(base: &[RecordingPiece], fresh: &RecordingPiece) -> Vec<PlannedPiece> {
    let fresh_start = song_frame(fresh.song_start_frame, 0, fresh.tempo);
    let fresh_end = song_frame(fresh.song_start_frame, fresh.frame_count, fresh.tempo);
    let mut pieces: Vec<PlannedPiece> = base
        .iter()
        .flat_map(|piece| cut_around(piece, fresh_start, fresh_end))
        .collect();
    pieces.push(PlannedPiece::whole(fresh));
    coalesce(pieces)
}

pub(crate) fn keep_base(base: &[RecordingPiece]) -> Vec<PlannedPiece> {
    base.iter().map(PlannedPiece::whole).collect()
}

pub(crate) fn base_pieces(pieces: &[RecordingPiece]) -> Vec<RecordingPiece> {
    pieces
        .iter()
        .filter(|piece| piece.layer == RecordingLayer::Base)
        .cloned()
        .collect()
}

pub(crate) fn fresh_piece(pieces: &[RecordingPiece]) -> Option<&RecordingPiece> {
    pieces
        .iter()
        .find(|piece| piece.layer == RecordingLayer::Fresh)
}

#[cfg(test)]
mod tests {
    use musetric_db::{RecordingLayer, RecordingPiece};

    use super::{PlannedPiece, SourceRange, merge_fresh};

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
        let fresh = piece("b", 10, 30, 1.0);

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
        let fresh = piece("b", 10, 60, 0.5);

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
        let fresh = piece("b", 50, 10, 1.0);

        let merged = merge_fresh(&base, &fresh);

        assert_eq!(merged.len(), 2);
        assert_eq!(merged[1].song_start_frame, 50);
    }

    #[test]
    fn keeps_a_one_frame_gap_apart() {
        let base = [piece("a", 0, 10, 1.0)];
        let fresh = piece("b", 11, 10, 1.0);

        let merged = merge_fresh(&base, &fresh);

        assert_eq!(merged.len(), 2);
        assert_eq!(merged[1].song_start_frame, 11);
    }

    #[test]
    fn glues_a_slow_take_that_ends_within_a_frame() {
        let base = [piece("a", 0, 21, 0.5)];
        let fresh = piece("b", 11, 10, 0.5);

        let merged = merge_fresh(&base, &fresh);

        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].frame_count, 31);
    }

    #[test]
    fn drops_a_piece_the_take_covers_entirely() {
        let base = [piece("a", 20, 10, 1.0), piece("c", 50, 10, 0.5)];
        let fresh = piece("b", 0, 40, 1.0);

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
        let fresh = piece("b", 20, 10, 1.0);

        let merged = merge_fresh(&base, &fresh);

        assert_eq!(merged[0].sources, [source("a", 0, 40)]);
        assert_eq!(merged[2].sources, [source("a", 60, 60)]);
        assert_eq!(merged[2].song_start_frame, 30);
    }
}
