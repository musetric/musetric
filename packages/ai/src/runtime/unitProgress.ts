export type UnitProgress = {
  unit: number;
  unitCount: number;
};

export type ReportUnit = (progress: UnitProgress) => void | Promise<void>;
