use std::io::{self, Write};

fn main() -> io::Result<()> {
    writeln!(
        io::stdout().lock(),
        "musetric-server {}",
        env!("CARGO_PKG_VERSION")
    )
}
