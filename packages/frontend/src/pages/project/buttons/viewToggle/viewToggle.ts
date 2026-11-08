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

export const toggleView = (target: ViewToggleTarget) => {
  const project = useProjectStore.getState();
  if (target.panel === 'details') {
    project.setDetailsView(
      project.detailsView === target.view ? undefined : target.view,
    );
    return;
  }
  const selected =
    project.spectrogramOpen &&
    engine.store.get().spectrogramView === target.view;
  project.setSpectrogramOpen(!selected);
  engine.store.update((state) => {
    state.spectrogramView = target.view;
  });
};
