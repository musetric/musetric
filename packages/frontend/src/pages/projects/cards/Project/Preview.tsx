import { Box, CircularProgress } from '@mui/material';
import { type api } from '@musetric/api';
import { type FC, useEffect } from 'react';
import { getProcessingProgress } from '../../../../common/processingStep.js';
import { ProjectPreview } from '../Preview.js';

const usePreloadImage = (previewUrl?: string) => {
  useEffect(() => {
    if (!previewUrl) return;
    const img = new Image();
    img.src = previewUrl;
  }, [previewUrl]);
};

export type ProjectCardPreviewProps = {
  projectInfo: api.project.Item;
};

export const ProjectCardPreview: FC<ProjectCardPreviewProps> = (props) => {
  const { projectInfo } = props;
  const { previewUrl } = projectInfo;

  usePreloadImage(previewUrl);

  const done = !!projectInfo.processing.done;
  const percent = Math.round(
    getProcessingProgress(projectInfo.processing) * 100,
  );

  return (
    <Box width={{ xs: 64, sm: 80 }} flexShrink={0}>
      <ProjectPreview url={previewUrl} name={projectInfo.name}>
        {!done && (
          <Box position='relative' display='inline-flex'>
            <CircularProgress
              variant='determinate'
              value={100}
              size={36}
              thickness={3}
              sx={{ color: 'rgba(0, 0, 0, 0.55)' }}
            />
            <CircularProgress
              variant='determinate'
              value={percent}
              size={36}
              thickness={3}
              sx={{ position: 'absolute', left: 0 }}
            />
          </Box>
        )}
      </ProjectPreview>
    </Box>
  );
};
