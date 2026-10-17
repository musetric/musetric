export type LatencyRoute = {
  outputLatencyFrameCount: number;
};

const isSameRoute = (
  route: LatencyRoute,
  outputLatencyFrameCount: number,
  toleranceFrameCount: number,
) =>
  Math.abs(route.outputLatencyFrameCount - outputLatencyFrameCount) <=
  toleranceFrameCount;

export type LatencyRouteOptions = {
  toleranceFrameCount: number;
  maxCount: number;
};

export const findLatencyRoute = <Route extends LatencyRoute>(
  routes: readonly Route[],
  outputLatencyFrameCount: number,
  options: LatencyRouteOptions,
): Route | undefined =>
  routes.find((route) =>
    isSameRoute(route, outputLatencyFrameCount, options.toleranceFrameCount),
  );

export const putLatencyRoute = <Route extends LatencyRoute>(
  routes: readonly Route[],
  route: Route,
  options: LatencyRouteOptions,
): Route[] =>
  [
    route,
    ...routes.filter(
      (other) =>
        !isSameRoute(
          other,
          route.outputLatencyFrameCount,
          options.toleranceFrameCount,
        ),
    ),
  ].slice(0, options.maxCount);
