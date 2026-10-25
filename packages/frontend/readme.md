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
