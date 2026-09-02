pub type Migration = &'static [&'static str];

const CREATE_PROJECT: &str = "
  CREATE TABLE Project (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    sampleRate INTEGER NOT NULL,
    frameCount INTEGER NOT NULL
  );
";

const CREATE_PROCESSING_ERROR: &str = "
  CREATE TABLE ProcessingError (
    projectId INTEGER NOT NULL,
    step TEXT NOT NULL CHECK (step IN ('separation', 'transcription', 'rhythm', 'key', 'chords')),
    message TEXT NOT NULL,
    PRIMARY KEY (projectId, step),
    FOREIGN KEY (projectId) REFERENCES Project(id) ON DELETE CASCADE
  );
";

const CREATE_AUDIO_MASTER: &str = "
  CREATE TABLE AudioMaster (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    projectId INTEGER NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('source', 'lead', 'backing', 'instrumental')),
    blobId TEXT NOT NULL UNIQUE,
    UNIQUE(projectId, type),
    FOREIGN KEY (projectId) REFERENCES Project(id) ON DELETE CASCADE
  );
";

const CREATE_AUDIO_MASTER_INDEX: &str = "
  CREATE INDEX AudioMaster_projectId_type_index ON AudioMaster (projectId, type);
";

const CREATE_PROJECT_AUDIO_ANALYSIS: &str = "
  CREATE TABLE ProjectAudioAnalysis (
    projectId INTEGER PRIMARY KEY,
    sourceIntegratedLoudnessDb REAL NOT NULL,
    sourceTruePeakDb REAL NOT NULL,
    sourceGainDb REAL NOT NULL,
    leadIntegratedLoudnessDb REAL NOT NULL,
    leadTruePeakDb REAL NOT NULL,
    leadP95RmsDb REAL NOT NULL,
    leadSpectrogramGainDb REAL NOT NULL,
    backingIntegratedLoudnessDb REAL NOT NULL,
    backingTruePeakDb REAL NOT NULL,
    instrumentalIntegratedLoudnessDb REAL NOT NULL,
    instrumentalTruePeakDb REAL NOT NULL,
    leadGainDb REAL NOT NULL,
    backingGainDb REAL NOT NULL,
    instrumentalGainDb REAL NOT NULL,
    FOREIGN KEY (projectId) REFERENCES Project(id) ON DELETE CASCADE
  );
";

const CREATE_AUDIO_DELIVERY: &str = "
  CREATE TABLE AudioDelivery (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    projectId INTEGER NOT NULL,
    stemType TEXT NOT NULL CHECK (stemType IN ('lead', 'backing', 'instrumental')),
    blobId TEXT NOT NULL UNIQUE,
    waveBlobId TEXT NOT NULL UNIQUE,
    UNIQUE(projectId, stemType),
    FOREIGN KEY (projectId) REFERENCES Project(id) ON DELETE CASCADE
  );
";

const CREATE_AUDIO_DELIVERY_INDEX: &str = "
  CREATE INDEX AudioDelivery_projectId_stemType_index ON AudioDelivery (projectId, stemType);
";

const CREATE_PREVIEW: &str = "
  CREATE TABLE Preview (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    projectId INTEGER NOT NULL UNIQUE,
    blobId TEXT NOT NULL UNIQUE,
    filename TEXT NOT NULL,
    contentType TEXT NOT NULL,
    FOREIGN KEY (projectId) REFERENCES Project(id) ON DELETE CASCADE
  );
";

const CREATE_SUBTITLE: &str = "
  CREATE TABLE Subtitle (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    projectId INTEGER NOT NULL UNIQUE,
    blobId TEXT NOT NULL UNIQUE,
    FOREIGN KEY (projectId) REFERENCES Project(id) ON DELETE CASCADE
  );
";

const CREATE_RHYTHM: &str = "
  CREATE TABLE Rhythm (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    projectId INTEGER NOT NULL UNIQUE,
    blobId TEXT NOT NULL UNIQUE,
    FOREIGN KEY (projectId) REFERENCES Project(id) ON DELETE CASCADE
  );
";

const CREATE_KEY: &str = "
  CREATE TABLE Key (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    projectId INTEGER NOT NULL UNIQUE,
    blobId TEXT NOT NULL UNIQUE,
    FOREIGN KEY (projectId) REFERENCES Project(id) ON DELETE CASCADE
  );
";

const CREATE_CHORDS: &str = "
  CREATE TABLE Chords (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    projectId INTEGER NOT NULL UNIQUE,
    blobId TEXT NOT NULL UNIQUE,
    FOREIGN KEY (projectId) REFERENCES Project(id) ON DELETE CASCADE
  );
";

const CREATE_RECORDING: &str = "
  CREATE TABLE Recording (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    projectId INTEGER NOT NULL,
    blobId TEXT NOT NULL UNIQUE,
    waveBlobId TEXT NOT NULL UNIQUE,
    sampleRate INTEGER NOT NULL,
    frameCount INTEGER NOT NULL,
    UNIQUE(projectId),
    FOREIGN KEY (projectId) REFERENCES Project(id) ON DELETE CASCADE
  );
";

const V001_INITIAL: Migration = &[
    CREATE_PROJECT,
    CREATE_PROCESSING_ERROR,
    CREATE_AUDIO_MASTER,
    CREATE_AUDIO_MASTER_INDEX,
    CREATE_PROJECT_AUDIO_ANALYSIS,
    CREATE_AUDIO_DELIVERY,
    CREATE_AUDIO_DELIVERY_INDEX,
    CREATE_PREVIEW,
    CREATE_SUBTITLE,
    CREATE_RHYTHM,
    CREATE_KEY,
    CREATE_CHORDS,
    CREATE_RECORDING,
];

pub const MIGRATIONS: &[Migration] = &[V001_INITIAL];
