import {
  Children,
  type FC,
  Fragment,
  isValidElement,
  type PropsWithChildren,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useMemoLocation } from '../common/locationEvent.js';
import { isMatchComponent } from './Match.js';

type MatchItem = {
  element: ReactElement;
  match: () => object | undefined;
};
const getMatchItems = (children?: ReactNode): MatchItem[] => {
  const items: MatchItem[] = [];

  // eslint-disable-next-line @eslint-react/no-children-for-each
  Children.forEach(children, (element) => {
    if (!isValidElement<PropsWithChildren>(element)) {
      return;
    }

    if (element.type === Fragment) {
      const fragmentRoutes = getMatchItems(element.props.children);
      items.push(...fragmentRoutes);
      return;
    }

    if (isMatchComponent(element.type)) {
      items.push({
        element,
        match: element.type.match,
      });
      return;
    }

    throw new Error('FirstMatch children must be Match components');
  });

  return items;
};
export const FirstMatch: FC<PropsWithChildren> = (props) => {
  const { children } = props;

  const items = getMatchItems(children);

  const item = useMemoLocation(() => items.find((entry) => entry.match()));

  return item?.element ?? undefined;
};
