!macro NSIS_HOOK_PREUNINSTALL
  IfSilent skip_data_prompt
  MessageBox MB_YESNO|MB_ICONQUESTION "Delete your Musetric data?$\r$\n$\r$\nProjects, recordings and about 2 GB of downloaded models will be removed. Keeping them lets a future install continue where you left off." IDNO skip_data_prompt
  RMDir /r "$LOCALAPPDATA\Musetric\storage"
  RMDir /r "$LOCALAPPDATA\Musetric\logs"
  RMDir /r "$LOCALAPPDATA\Musetric\models"
  RMDir "$LOCALAPPDATA\Musetric"
  skip_data_prompt:
!macroend
