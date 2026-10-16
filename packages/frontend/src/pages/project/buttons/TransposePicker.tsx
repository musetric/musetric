import {
  Box,
  Drawer,
  Popover,
  type PopoverActions,
  useMediaQuery,
} from '@mui/material';
import { type FC, useEffect, useRef } from 'react';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { pickerPlacements } from '../pickerPlacement.js';
import { useProjectStore } from '../store.js';
import { TransposePickerContent } from './TransposePickerContent.js';

export const TransposePicker: FC = () => {
  const isDesktop = useMediaQuery((theme) => theme.breakpoints.up('sm'));
  const transposeAnchorEl = useProjectStore((state) => state.transposeAnchorEl);
  const setTransposeAnchorEl = useProjectStore(
    (state) => state.setTransposeAnchorEl,
  );
  const pickerSide = useProjectStore((state) => state.pickerSide);
  const voiceOctave = useEngineStore((state) => state.voiceOctave);
  const popoverActionsRef = useRef<PopoverActions>(null);

  useEffect(() => {
    popoverActionsRef.current?.updatePosition();
  }, [voiceOctave]);

  if (isDesktop) {
    return (
      <Popover
        action={popoverActionsRef}
        open={transposeAnchorEl !== undefined}
        anchorEl={transposeAnchorEl}
        onClose={() => {
          setTransposeAnchorEl(undefined);
        }}
        {...pickerPlacements[pickerSide]}
      >
        <Box sx={{ width: 380, p: 4 }}>
          <TransposePickerContent />
        </Box>
      </Popover>
    );
  }

  return (
    <Drawer
      anchor='bottom'
      open={transposeAnchorEl !== undefined}
      onClose={() => {
        setTransposeAnchorEl(undefined);
      }}
    >
      <Box
        sx={{
          width: '100%',
          maxWidth: 460,
          mx: 'auto',
          p: 4,
          pb: 'max(18px, env(safe-area-inset-bottom))',
        }}
      >
        <TransposePickerContent />
      </Box>
    </Drawer>
  );
};
