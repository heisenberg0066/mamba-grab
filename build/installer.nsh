; Mamba Grab — NSIS additions (per user, HKCU).
; Registers the native-messaging host com.ammar.mambagrab for Chrome, Edge, Chromium and Brave; removed on uninstall.

!macro customCheckAppRunning
  nsExec::Exec '"$SYSDIR\cmd.exe" /c taskkill /f /im "${APP_EXECUTABLE_FILENAME}" /fi "USERNAME eq %USERNAME%"'
  Pop $0
  Sleep 500
!macroend

!macro customInstall
  WriteRegStr HKCU "Software\Google\Chrome\NativeMessagingHosts\com.ammar.mambagrab" "" "$INSTDIR\resources\host\com.ammar.mambagrab.json"
  WriteRegStr HKCU "Software\Microsoft\Edge\NativeMessagingHosts\com.ammar.mambagrab" "" "$INSTDIR\resources\host\com.ammar.mambagrab.json"
  WriteRegStr HKCU "Software\Chromium\NativeMessagingHosts\com.ammar.mambagrab" "" "$INSTDIR\resources\host\com.ammar.mambagrab.json"
  WriteRegStr HKCU "Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.ammar.mambagrab" "" "$INSTDIR\resources\host\com.ammar.mambagrab.json"
  CreateShortCut "$SMPROGRAMS\Mamba Grab Extension Folder.lnk" "$INSTDIR\resources\extension"
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Google\Chrome\NativeMessagingHosts\com.ammar.mambagrab"
  DeleteRegKey HKCU "Software\Microsoft\Edge\NativeMessagingHosts\com.ammar.mambagrab"
  DeleteRegKey HKCU "Software\Chromium\NativeMessagingHosts\com.ammar.mambagrab"
  DeleteRegKey HKCU "Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.ammar.mambagrab"
  Delete "$SMPROGRAMS\Mamba Grab Extension Folder.lnk"
!macroend
