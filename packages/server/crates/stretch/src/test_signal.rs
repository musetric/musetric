pub(crate) fn to_float(value: usize) -> f32 {
    f32::from(u16::try_from(value).expect("test sizes fit u16"))
}

pub(crate) fn signal(length: usize) -> Vec<f32> {
    (0..length)
        .map(|index| to_float(index * 7 % 13) / 6.0 - 1.0)
        .collect()
}
