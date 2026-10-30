export type VocalMarkStatus = 'trait' | 'match' | 'differ';

export type VocalMarkOf<Kind extends string, Traits, Advice extends string> = {
  kind: Kind;
  start: number;
  end: number;
  status: VocalMarkStatus;
  advice?: Advice;
  lead: Traits;
  take?: Traits;
};

export type VocalDifference<Advice extends string> = {
  advice: Advice;
  size: number;
};
