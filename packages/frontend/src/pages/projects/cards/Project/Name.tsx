import { Typography } from '@mui/material';
import { type FC } from 'react';

export type ProjectCardNameProps = {
  name: string;
};
export const ProjectCardName: FC<ProjectCardNameProps> = (props) => {
  const { name } = props;

  return (
    <Typography variant='subtitle1' noWrap title={name}>
      {name}
    </Typography>
  );
};
