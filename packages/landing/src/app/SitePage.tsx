import { Box } from '@mui/material';
import { type ReactNode } from 'react';
import { SiteFooter } from './SiteFooter.js';

type SitePageProps = {
  children: ReactNode;
};

export const SitePage = (props: SitePageProps) => {
  const { children } = props;

  return (
    <Box component='main' sx={{ backgroundColor: 'background.default' }}>
      {children}
      <SiteFooter />
    </Box>
  );
};
