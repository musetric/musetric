import { type ComponentType } from 'react';
import { useMemoLocation } from '../common/locationEvent.js';

export type MatchProps<Params> = {
  component: ComponentType<Params>;
};
export type MatchFC<Params> = ComponentType<MatchProps<Params>> & {
  match: () => Params | undefined;
};

export const createMatch = <Params,>(
  match: () => Params | undefined,
  prefixName?: string,
) => {
  const Match: MatchFC<Params> = (props) => {
    const Component = props.component;
    const params = useMemoLocation(match);
    return params ? <Component {...params} /> : undefined;
  };
  Match.match = match;
  if (prefixName) {
    Match.displayName = `${prefixName}Match`;
  }

  return Match;
};

export const isMatchComponent = (
  component: unknown,
): component is MatchFC<object> =>
  typeof component === 'function' &&
  'match' in component &&
  typeof component.match === 'function';
