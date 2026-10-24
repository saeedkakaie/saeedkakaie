; نصب‌کننده ویندوز IBP گروه زر
; فایل‌ها مستقیم در پوشه نصب باز می‌شوند (بدون ساخت بسته موقت بزرگ در Temp که آنتی‌ویروس یا کمبود فضا آن را خراب می‌کرد)
; ورودی‌ها از build.js: VERSION، SRCDIR (پوشه win-unpacked)، OUTFILE، ICON

Unicode true
ManifestDPIAware true
SetCompressor /SOLID lzma
SetCompressorDictSize 64
RequestExecutionLevel user

!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "LogicLib.nsh"

!define APPNAME "Zar IBP"
!define DISPLAYNAME "IBP گروه زر"
!define COMPANY "Zar Group"
!define EXE "Zar IBP.exe"
!define UNINST_EXE "Uninstall Zar IBP.exe"
!define REGKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\ZarIBP"

Name "${DISPLAYNAME}"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\Zar IBP"
InstallDirRegKey HKCU "Software\Zar IBP" "InstallDir"
BrandingText "Zar IBP ${VERSION}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=0 "ProductName" "${APPNAME}"
VIAddVersionKey /LANG=0 "CompanyName" "${COMPANY}"
VIAddVersionKey /LANG=0 "FileDescription" "${APPNAME} Setup"
VIAddVersionKey /LANG=0 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=0 "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=0 "LegalCopyright" "${COMPANY}"

!define MUI_ICON "${ICON}"
!define MUI_UNICON "${ICON}"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "اجرای ${DISPLAYNAME}"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Farsi"

; بستن برنامه در حال اجرا (و موتور تحلیل که زیرمجموعه آن است) پیش از جایگزینی فایل‌ها
!macro CloseApp
  nsExec::ExecToStack 'cmd /c tasklist /FI "IMAGENAME eq ${EXE}" /NH | find /I "${EXE}"'
  Pop $0
  Pop $1
  ${If} $0 == 0
    ${IfNot} ${Silent}
      MessageBox MB_OKCANCEL|MB_ICONINFORMATION "برنامه ${DISPLAYNAME} باز است و بسته می‌شود." IDOK +2
      Abort
    ${EndIf}
    nsExec::Exec 'taskkill /F /T /IM "${EXE}"'
    Pop $0
    Sleep 1500
  ${EndIf}
!macroend

Section "Install"
  !insertmacro CloseApp
  SetOutPath "$INSTDIR"
  ; فایل‌های نسخه قبل (نه داده‌ها که در AppData هستند) پاک می‌شوند تا فایل کهنه نماند
  RMDir /r "$INSTDIR\resources"
  RMDir /r "$INSTDIR\locales"
  SetOverwrite on
  File /r "${SRCDIR}\*.*"
  WriteUninstaller "$INSTDIR\${UNINST_EXE}"

  ; میانبرها: میز کار و منوی شروع
  SetShellVarContext current
  CreateShortCut "$DESKTOP\${DISPLAYNAME}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\${EXE}" 0
  CreateShortCut "$SMPROGRAMS\${DISPLAYNAME}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\${EXE}" 0

  WriteRegStr HKCU "Software\Zar IBP" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${REGKEY}" "DisplayName" "${DISPLAYNAME}"
  WriteRegStr HKCU "${REGKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${REGKEY}" "Publisher" "${COMPANY}"
  WriteRegStr HKCU "${REGKEY}" "DisplayIcon" "$INSTDIR\${EXE},0"
  WriteRegStr HKCU "${REGKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${REGKEY}" "UninstallString" '"$INSTDIR\${UNINST_EXE}"'
  WriteRegStr HKCU "${REGKEY}" "QuietUninstallString" '"$INSTDIR\${UNINST_EXE}" /S'
  WriteRegDWORD HKCU "${REGKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${REGKEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  WriteRegDWORD HKCU "${REGKEY}" "EstimatedSize" $0

  ; به‌روزرسانی خودکار (electron-updater) نصب‌کننده را بی‌صدا اجرا می‌کند؛ پس از آن برنامه دوباره باز می‌شود
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "--force-run" $R1
  ${IfNot} ${Errors}
    Exec '"$INSTDIR\${EXE}"'
  ${EndIf}
SectionEnd

Section "Uninstall"
  !insertmacro CloseApp
  SetShellVarContext current
  Delete "$DESKTOP\${DISPLAYNAME}.lnk"
  Delete "$SMPROGRAMS\${DISPLAYNAME}.lnk"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${REGKEY}"
  DeleteRegKey HKCU "Software\Zar IBP"
  ; داده‌های کاربر (%APPDATA%\Zar IBP) عمداً حذف نمی‌شوند
SectionEnd
