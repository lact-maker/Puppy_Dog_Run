param([string]$ToolRoot = 'C:\Users\ll\Documents\Codex\2026-09-29\new-chat\work')
$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
$env:JAVA_HOME = (Get-ChildItem -LiteralPath "$ToolRoot/tools/jdk" -Directory | Select-Object -First 1).FullName
$env:ANDROID_HOME = "$ToolRoot/tools/android-sdk"
$env:ANDROID_USER_HOME = "$ToolRoot/android-user"
$env:GRADLE_USER_HOME = "$ToolRoot/gradle-user"
$env:Path = "$env:JAVA_HOME/bin;$env:Path"
Push-Location -LiteralPath $projectPath
try {
    node scripts/sync-android.mjs
    if ($LASTEXITCODE -ne 0) { throw '资源同步失败' }
    & "$ToolRoot/tools/gradle/gradle-8.13/bin/gradle.bat" -p "$projectPath/android" --offline --no-daemon --console=plain assembleDebug
    if ($LASTEXITCODE -ne 0) { throw '安卓构建失败' }
    New-Item -ItemType Directory -Force -Path "$projectPath/artifacts" | Out-Null
    Copy-Item -LiteralPath "$projectPath/android/app/build/outputs/apk/debug/app-debug.apk" -Destination "$projectPath/artifacts/小狗双人跑酷-0.8.0.apk" -Force
    Write-Output "APK: $projectPath/artifacts/小狗双人跑酷-0.8.0.apk"
} finally { Pop-Location }
