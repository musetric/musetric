import { type Logger } from '@musetric/utils';
import { spawnScript } from '@musetric/utils/node';

const parseNumber = (value: unknown, label: string): number => {
  const rawNumber = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(rawNumber)) {
    throw new Error(`Invalid loudness ${label}`);
  }
  return rawNumber;
};

export type LoudnessAnalysis = {
  integratedLoudnessDb: number;
  truePeakDb: number;
};

const parseLoudnormJson = (output: string): LoudnessAnalysis => {
  const start = output.indexOf('{');
  const end = output.lastIndexOf('}');
  if (start === -1 || end < start) {
    throw new Error('ffmpeg loudnorm output is missing JSON');
  }

  const parsed: unknown = JSON.parse(output.slice(start, end + 1));
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('ffmpeg loudnorm JSON is invalid');
  }

  return {
    integratedLoudnessDb: parseNumber(
      'input_i' in parsed ? parsed.input_i : undefined,
      'input_i',
    ),
    truePeakDb: parseNumber(
      'input_tp' in parsed ? parsed.input_tp : undefined,
      'input_tp',
    ),
  };
};

export type AnalyzeLoudnessOptions = {
  fromPath: string;
  logger: Logger;
};

export const analyzeLoudness = async (
  options: AnalyzeLoudnessOptions,
): Promise<LoudnessAnalysis> => {
  const { fromPath, logger } = options;
  const stderrLines: string[] = [];

  await spawnScript({
    command: 'ffmpeg',
    flatArgs: [
      '-hide_banner',
      '-nostats',
      '-i',
      fromPath,
      '-map',
      '0:a:0',
      '-sn',
      '-dn',
      '-vn',
      '-af',
      'loudnorm=print_format=json',
      '-f',
      'null',
      '-',
    ],
    stderr: {
      mode: 'text',
      onLine: (line) => {
        stderrLines.push(line);
      },
    },
    logger,
    processName: 'analyzeLoudness',
  });

  return parseLoudnormJson(stderrLines.join('\n'));
};
