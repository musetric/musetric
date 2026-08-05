!macro customUnInstall
  ${ifNot} ${isUpdated}
    StrCpy $R2 "0"

    ClearErrors
    ${GetParameters} $R0
    ${GetOptions} $R0 "--delete-app-data" $R1
    ${ifNot} ${Errors}
      StrCpy $R2 "1"
    ${elseIfNot} ${Silent}
      MessageBox MB_YESNO|MB_ICONQUESTION "Delete your ${PRODUCT_NAME} data?$\r$\n$\r$\nProjects, recordings and about 2 GB of downloaded models will be removed. Keeping them lets a future install continue where you left off." /SD IDNO IDNO +2
      StrCpy $R2 "1"
    ${endIf}

    ${if} $R2 == "1"
      ${if} $installMode == "all"
        SetShellVarContext current
      ${endIf}
      RMDir /r "$LOCALAPPDATA\${PRODUCT_NAME}\storage"
      RMDir /r "$LOCALAPPDATA\${PRODUCT_NAME}\session"
      Delete "$LOCALAPPDATA\${PRODUCT_NAME}\lockfile"
      RMDir "$LOCALAPPDATA\${PRODUCT_NAME}"
      ${if} $installMode == "all"
        SetShellVarContext all
      ${endIf}
    ${endIf}
  ${endIf}
!macroend
