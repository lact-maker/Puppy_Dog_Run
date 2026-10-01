$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectPath
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCommand) { & $nodeCommand.Source server/index.mjs }
else {
    $bundledNode = 'C:\Users\ll\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
    if (!(Test-Path -LiteralPath $bundledNode)) { throw '需要安装 Node.js 22 或更新版本。' }
    & $bundledNode server/index.mjs
}
