import {
  convertToFlac,
  flacAudioOutput,
  getAudioFrameCount,
} from '@musetric/toolkit';
import { defaultSampleRate, type Logger } from '@musetric/utils';
import { type BlobFile, type BlobStorage } from '@musetric/utils/node';

const removeBlobIfExists = async (
  blobStorage: BlobStorage,
  blobId: string,
  logger: Logger,
): Promise<void> => {
  try {
    if (await blobStorage.exists(blobId)) {
      await blobStorage.remove(blobId);
    }
  } catch (error) {
    logger.warn({ blobId, error }, 'Failed to remove upload helper blob');
  }
};

const createInvalidAudioError = (cause: unknown) => {
  const error = new Error('Uploaded audio file is invalid');
  return Object.assign(error, {
    statusCode: 400,
    cause,
  });
};

export type ProjectSource = BlobFile & {
  sampleRate: number;
  frameCount: number;
};

export type CreateProjectSourceOptions = {
  blobStorage: BlobStorage;
  file: File;
  logger: Logger;
};

export const createProjectSource = async (
  options: CreateProjectSourceOptions,
): Promise<ProjectSource> => {
  const { blobStorage, file, logger } = options;
  const uploadedSource = await blobStorage.addFile(file);
  const normalizedSource = blobStorage.createPath();

  try {
    await convertToFlac({
      fromPath: blobStorage.getPath(uploadedSource.blobId),
      toPath: normalizedSource.blobPath,
      sampleRate: defaultSampleRate,
      logger,
    });
    const frameCount = await getAudioFrameCount(
      normalizedSource.blobPath,
      defaultSampleRate,
      logger,
    );

    await removeBlobIfExists(blobStorage, uploadedSource.blobId, logger);

    return {
      blobId: normalizedSource.blobId,
      filename: uploadedSource.filename,
      contentType: flacAudioOutput.contentType,
      sampleRate: defaultSampleRate,
      frameCount,
    };
  } catch (error) {
    await Promise.all([
      removeBlobIfExists(blobStorage, uploadedSource.blobId, logger),
      removeBlobIfExists(blobStorage, normalizedSource.blobId, logger),
    ]);
    throw createInvalidAudioError(error);
  }
};
