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

## Decisions it follows

The owner's decisions this package carries out, kept in
[headquarters](https://github.com/musetric/headquarters/tree/main/decisions):

- Notes compares in cents with the singer's own line ([R-31](https://github.com/musetric/headquarters/blob/main/decisions/r31-notes-in-cents.md)).
- Singing and recording work at any tempo and key ([R-32](https://github.com/musetric/headquarters/blob/main/decisions/r32-record-at-any-tempo-and-key.md)).
- A song keeps several recordings, one of them active ([R-34](https://github.com/musetric/headquarters/blob/main/decisions/r34-several-recordings.md)).
- A line is practised in a loop, and only the chosen try is kept ([R-36](https://github.com/musetric/headquarters/blob/main/decisions/r36-loop-pass-by-pass.md)).
- The octave moves the picture, not the sound ([R-37](https://github.com/musetric/headquarters/blob/main/decisions/r37-octave-moves-the-picture.md)).
