import { Box, CardMedia, Stack, Typography } from '@mui/material';
import { type FC, type PropsWithChildren } from 'react';
import { contentPlaceholderPattern } from '../common/cardBackgroundPattern.js';

const getCoverLetter = (name: string): string =>
  [...name.trim()][0]?.toUpperCase() ?? '';

export type ProjectPreviewProps = {
  url?: string;
  name?: string;
};
type Props = ProjectPreviewProps & PropsWithChildren;
export const ProjectPreview: FC<Props> = (props) => {
  const { url, name, children } = props;

  if (!url) {
    return (
      <Stack
        justifyContent='center'
        alignItems='center'
        sx={{
          userSelect: 'none',
          containerType: 'inline-size',
          aspectRatio: '1 / 1',
          borderRadius: 2,
          background: contentPlaceholderPattern,
        }}
      >
        {children || (
          <Typography
            component='span'
            sx={{
              fontSize: '38cqw',
              fontWeight: 600,
              opacity: 0.5,
              lineHeight: 1,
            }}
          >
            {name ? getCoverLetter(name) : ''}
          </Typography>
        )}
      </Stack>
    );
  }

  return (
    <Box position='relative'>
      <CardMedia
        component='img'
        image={url}
        sx={{
          aspectRatio: '1 / 1',
          borderRadius: 2,
          objectFit: 'cover',
        }}
      />
      {children && (
        <Stack
          position='absolute'
          top={0}
          right={0}
          bottom={0}
          left={0}
          justifyContent='center'
          alignItems='center'
          sx={{ borderRadius: 2, backgroundColor: 'rgba(0, 0, 0, 0.55)' }}
        >
          {children}
        </Stack>
      )}
    </Box>
  );
};
