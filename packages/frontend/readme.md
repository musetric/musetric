# @musetric/frontend

The main React application of Musetric, shown in the WebView of the Tauri
shell.

## Interface rules

- One value, one control: a value has one way to be changed, and what is
  only information is shown as text, not as another control.
- An approved mockup is the requirement, over the preference for stock
  Material UI styles too: before calling an interface done, put a screenshot
  of it next to the mockup.
- A styling request changes only the component's look, using the state that
  already exists; it does not rework the component.
- Anchors such as Home and Menu keep their corners at every width
  (`ProjectHeader.tsx`), and so do the view switches of the dock. On a phone,
  a row of controls is spread evenly across the width, never clustered
  (`space-between` in `PlaybackPanel.tsx`).
- The recording comes first wherever it is listed with the tracks: the first
  lane in Tracks, the band above the lead in Spectrum, the first slider in
  Mix, which the export opens too. Mix has no choice of recording, only the
  active one's name as plain text; a row of the recording list shows only the
  name and the wave.
- A control inside the spectrogram or another area with a pointer gesture
  stops the native `pointerdown` itself (`recording/useKeepFromGestures.ts`).

## Build

`build:project`, also run from the root, builds into `dist` and copies the
build over `../server/storage/public`, clearing it first, for the server of
`yarn dev`; a second server gets its own build from
`vite build --configLoader native --outDir <dir>`.

## Decisions it follows

- Notes compares in cents with the singer's own line ([R-31](https://github.com/musetric/headquarters/blob/main/decisions/r31-notes-in-cents.md)).
- Singing and recording work at any tempo and key ([R-32](https://github.com/musetric/headquarters/blob/main/decisions/r32-record-at-any-tempo-and-key.md)).
- A song keeps several recordings, one of them active ([R-34](https://github.com/musetric/headquarters/blob/main/decisions/r34-several-recordings.md)).
- A line is practised in a loop, and only the chosen try is kept ([R-36](https://github.com/musetric/headquarters/blob/main/decisions/r36-loop-pass-by-pass.md)).
- The octave moves the picture, not the sound ([R-37](https://github.com/musetric/headquarters/blob/main/decisions/r37-octave-moves-the-picture.md)).
