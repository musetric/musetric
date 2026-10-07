use musetric_db::{RecordingLayer, RecordingPiece};

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct SourceRange {
    pub(crate) blob_id: String,
    pub(crate) start_frame: i64,
    pub(crate) frame_count: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct PlannedPiece {
    pub(crate) sources: Vec<SourceRange>,
    pub(crate) song_start_frame: i64,
    pub(crate) frame_count: i64,
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
        }
    }

    fn part(piece: &RecordingPiece, start_frame: i64, frame_count: i64) -> Self {
        Self {
            sources: vec![SourceRange {
                blob_id: piece.blob_id.clone(),
                start_frame,
                frame_count,
            }],
            song_start_frame: piece.song_start_frame + start_frame,
            frame_count,
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

    fn song_end(&self) -> i64 {
        self.song_start_frame + self.frame_count
    }
}

fn recorded_frame(piece: &RecordingPiece, song_frame: i64) -> i64 {
    (song_frame - piece.song_start_frame).clamp(0, piece.frame_count)
}

fn cut_around(piece: &RecordingPiece, fresh_start: i64, fresh_end: i64) -> Vec<PlannedPiece> {
    let start = piece.song_start_frame;
    let end = start + piece.frame_count;
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
    previous.song_end() == next.song_start_frame
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
    let fresh_start = fresh.song_start_frame;
    let fresh_end = fresh_start + fresh.frame_count;
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

    fn piece(blob_id: &str, song_start_frame: i64, frame_count: i64) -> RecordingPiece {
        RecordingPiece {
            blob_id: blob_id.to_owned(),
            layer: RecordingLayer::Base,
            song_start_frame,
            frame_count,
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
    fn glues_a_touching_take_into_one_piece() {
        let base = [piece("a", 0, 60)];
        let fresh = piece("b", 10, 30);

        let merged = merge_fresh(&base, &fresh);

        assert_eq!(
            merged,
            [PlannedPiece {
                sources: vec![source("a", 0, 10), source("b", 0, 30), source("a", 40, 20)],
                song_start_frame: 0,
                frame_count: 60,
            }]
        );
    }

    #[test]
    fn keeps_gaps_between_pieces_apart() {
        let base = [piece("a", 0, 10)];
        let fresh = piece("b", 50, 10);

        let merged = merge_fresh(&base, &fresh);

        assert_eq!(merged.len(), 2);
        assert_eq!(merged[1].song_start_frame, 50);
    }

    #[test]
    fn drops_a_piece_the_take_covers_entirely() {
        let base = [piece("a", 20, 10), piece("c", 50, 10)];
        let fresh = piece("b", 0, 40);

        let merged = merge_fresh(&base, &fresh);

        assert_eq!(
            merged,
            [
                PlannedPiece {
                    sources: vec![source("b", 0, 40)],
                    song_start_frame: 0,
                    frame_count: 40,
                },
                PlannedPiece {
                    sources: vec![source("c", 0, 10)],
                    song_start_frame: 50,
                    frame_count: 10,
                },
            ]
        );
    }
}
