import { type SpectrogramViewMode } from '@musetric/engine';
import { engine } from '../../../../engine/engine.js';
import { type DetailsView, useProjectStore } from '../../store.js';

export type ViewToggleTarget =
  | {
      panel: 'details';
      view: DetailsView;
    }
  | {
      panel: 'spectrogram';
      view: SpectrogramViewMode;
    };

export type ViewToggleState = {
  detailsView?: DetailsView;
  spectrogramOpen: boolean;
  spectrogramView: SpectrogramViewMode;
};

export const isViewSelected = (
  target: ViewToggleTarget,
  state: ViewToggleState,
): boolean =>
  target.panel === 'details'
    ? state.detailsView === target.view
    : state.spectrogramOpen && state.spectrogramView === target.view;

export const toggleView = (target: ViewToggleTarget) => {
  const project = useProjectStore.getState();
  const selected = isViewSelected(target, {
    detailsView: project.detailsView,
    spectrogramOpen: project.spectrogramOpen,
    spectrogramView: engine.store.get().spectrogramView,
  });
  if (target.panel === 'details') {
    project.setDetailsView(selected ? undefined : target.view);
    return;
  }
  project.setSpectrogramOpen(!selected);
  engine.store.update((state) => {
    state.spectrogramView = target.view;
  });
};
