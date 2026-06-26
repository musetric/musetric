import { useEffect, useMemo } from 'react';
import { create } from 'zustand';

const useLocationStore = create(() => ({}));

export const onChangeLocation = () => {
  useLocationStore.setState({});
};

export const useMemoLocation = <T>(callback: () => T) => {
  const event = useLocationStore();
  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/use-memo
  const result = useMemo(callback, [event]);
  return result;
};

export const useSyncHistoryLocation = () => {
  useEffect(() => {
    window.addEventListener('popstate', onChangeLocation);
    return () => window.removeEventListener('popstate', onChangeLocation);
  }, []);
};
