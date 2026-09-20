import { type FC } from 'react';
import { AppPage } from '../../app/AppPage.js';
import { ProcessingQueue } from './ProcessingQueue.js';
import { ProcessingTitle } from './Title.js';

export const ProcessingPage: FC = () => (
  <AppPage>
    <ProcessingTitle />
    <ProcessingQueue />
  </AppPage>
);
