; Sawa-Setup-<version>.exe — single-file NSIS wrapper.
;
; Behaviour:
;   1. Extract payload (installer-ui.exe + resources/ + backend/) to a
;      unique %TEMP%\sawa-installer-<rand> directory
;   2. Launch installer-ui.exe (the custom branded wizard)
;   3. Wait for it to finish
;   4. Clean up the temp directory
;
; This script is generated to wrap the `release-installer/win-unpacked/`
; output produced by electron-builder. The user-facing UX (UAC prompt,
; window, all branding) is owned by installer-ui.exe — this wrapper does
; nothing visible besides the brief extraction.

!include "FileFunc.nsh"
!include "LogicLib.nsh"

;-------------------------------- inputs ------------------------------------
; Set by build-installer.mjs via /D switches at makensis invocation time:
;   /DPAYLOAD_DIR=<absolute path to win-unpacked>
;   /DOUTPUT_FILE=<final exe path>
;   /DPRODUCT_VERSION=5.0.1
;   /DICON_FILE=<absolute path to .ico>

!ifndef PAYLOAD_DIR
  !error "PAYLOAD_DIR not defined — pass /DPAYLOAD_DIR=... to makensis"
!endif
!ifndef OUTPUT_FILE
  !error "OUTPUT_FILE not defined — pass /DOUTPUT_FILE=... to makensis"
!endif
!ifndef PRODUCT_VERSION
  !define PRODUCT_VERSION "0.0.0"
!endif

;-------------------------------- header ------------------------------------
Name "Sawa Manga Library Setup"
Caption "Sawa Manga Library — Setup ${PRODUCT_VERSION}"
OutFile "${OUTPUT_FILE}"

!ifdef ICON_FILE
  Icon "${ICON_FILE}"
!endif

RequestExecutionLevel user
SetCompressor /SOLID lzma
SetCompressorDictSize 64
SilentInstall silent
ShowInstDetails hide
AutoCloseWindow true

VIProductVersion "${PRODUCT_VERSION}.0"
VIAddVersionKey "ProductName"     "Sawa Manga Library Setup"
VIAddVersionKey "FileDescription" "Sawa Manga Library — Setup"
VIAddVersionKey "ProductVersion"  "${PRODUCT_VERSION}"
VIAddVersionKey "FileVersion"     "${PRODUCT_VERSION}"
VIAddVersionKey "CompanyName"     "Sawahiro"
VIAddVersionKey "LegalCopyright"  "(c) 2025 Sawahiro"

;-------------------------------- body --------------------------------------
Var StageDir
Var ExitCode

Section "Sawa Setup"
  ; Pick a fresh staging dir under %TEMP%
  GetTempFileName $0 "$TEMP"
  Delete "$0"          ; we want a directory, not the temp file
  StrCpy $StageDir "$0.dir"
  CreateDirectory "$StageDir"
  SetOutPath "$StageDir"

  ; Recurse the entire payload tree into the temp dir.
  ; The "*.*" pattern is the canonical NSIS recipe for "everything,
  ; recursively". Bare "*" is treated literally and may skip subdirs.
  File /r "${PAYLOAD_DIR}\*.*"

  ; Launch the branded wizard and wait for it to exit.
  ExecWait '"$StageDir\installer-ui.exe"' $ExitCode

  ; Cleanup — best effort. If a file is still locked by an antivirus we
  ; just leave it for Windows' temp cleaner.
  ; DEBUG: skip cleanup when SAWA_KEEP_STAGE env var is set, so the
  ; stage dir survives for inspection.
  ReadEnvStr $0 "SAWA_KEEP_STAGE"
  ${If} $0 == ""
    SetOutPath "$TEMP"
    RMDir /r "$StageDir"
  ${EndIf}

  ; Bubble up the exit code so callers (CI, scripts) can detect failures.
  SetErrorLevel $ExitCode
SectionEnd
