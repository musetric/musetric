mod analysis;
mod blob_response;
mod blobs;
mod cached_file;
mod failure;
mod form;
mod frontend;
mod garbage;
mod host;
mod realtime;
mod router;
mod routes;
mod serve;
mod storage;
mod wav;

#[cfg(test)]
mod test_workspace;

pub use frontend::{Frontend, FrontendAsset, FrontendAssets};
pub use musetric_db::BoxedError;
pub use serve::{
    EmbeddedServer, EmbeddedServerOptions, ServerOptions, TlsOptions, serve, start_embedded,
};
