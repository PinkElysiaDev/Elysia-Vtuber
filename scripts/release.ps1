# ============================================================
# 本地构建发布脚本：三件套打包 → release/ → gh release（可选自动）
# 用法：
#   powershell -ExecutionPolicy Bypass -File scripts/release.ps1              # 用 package.json 版本
#   powershell -ExecutionPolicy Bypass -File scripts/release.ps1 -Version 0.3.0
#   powershell -ExecutionPolicy Bypass -File scripts/release.ps1 -SkipBuild   # 只重新打包
# 产物：release/vtuber-executors-win64-<v>.zip
#       release/vtuber-backend-<v>.zip
#       release/koishi-plugin-vtuber-<v>.tgz
#       release/RELEASE_NOTES.md
# ============================================================
param(
  [string]$Version = "",
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
# git 中文输出按 UTF-8 解码（否则 RELEASE_NOTES 乱码）
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$repo = Split-Path -Parent $PSScriptRoot   # 仓库根（external/vtuber）
Push-Location $repo

# ---------- 版本 ----------
if (-not $Version) {
  $Version = (Get-Content package.json -Raw | ConvertFrom-Json).version
}
$tag = "v$Version"
Write-Host "== Release $tag ==" -ForegroundColor Cyan

# ---------- 前置检查 ----------
function Assert-Cmd($name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "缺少 $name，请先安装并加入 PATH"
  }
}
Assert-Cmd cmake
Assert-Cmd npm

# Cubism SDK 与第三方库路径：优先复用现有 CMakeCache（与本地开发环境一致）
$sdkPath = ''
if (Test-Path 'cpp-executor/build/CMakeCache.txt') {
  $cache = Get-Content 'cpp-executor/build/CMakeCache.txt' -Raw
  if ($cache -match 'CUBISM_SDK_PATH:PATH=(\S+)') { $sdkPath = $Matches[1] }
  if ($cache -match 'VTUBER_THIRD_PARTY_DIR:PATH=(\S+)') { $tpDir = $Matches[1] }
}
if (-not $sdkPath -or -not (Test-Path (Join-Path $sdkPath 'Core/include/Live2DCubismCore.h'))) {
  throw "Cubism SDK 未找到（CUBISM_SDK_PATH=$sdkPath）。请先在本地完成一次 cmake configure。"
}
if (-not (Test-Path $tpDir)) {
  throw "第三方头文件目录未找到：$tpDir"
}
Write-Host "Cubism SDK: $sdkPath"

# ---------- 构建 ----------
if (-not $SkipBuild) {
  Write-Host "`n[1/4] 构建 Koishi 插件 (tsc -> lib/)" -ForegroundColor Yellow
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "插件构建失败" }

  Write-Host "`n[2/4] 构建 Node 后端 (tsc -> dist/)" -ForegroundColor Yellow
  Push-Location backend
  npm run build
  if ($LASTEXITCODE -ne 0) { Pop-Location; throw "后端构建失败" }
  Pop-Location

  Write-Host "`n[3/4] 构建 C++ 执行器 (Release)" -ForegroundColor Yellow
  cmake --build cpp-executor/build --config Release --parallel
  if ($LASTEXITCODE -ne 0) { throw "执行器构建失败" }
} else {
  Write-Host "`n[SkipBuild] 跳过构建，仅打包" -ForegroundColor DarkGray
}

$relDir = Join-Path $repo 'release'
if (Test-Path $relDir) { Remove-Item $relDir -Recurse -Force }
New-Item $relDir -ItemType Directory | Out-Null

# ---------- 打包：执行器 ----------
Write-Host "`n[4/4] 打包" -ForegroundColor Yellow
$execSrc = 'cpp-executor/build/Release'
$execStage = Join-Path $relDir '_executors'
New-Item $execStage -ItemType Directory | Out-Null
$execItems = @(
  'audio_executor.exe', 'audio-executor.json',
  'vtuber_executor.exe', 'executor.json',
  'Live2DCubismCore.dll',
  'FrameworkShaders', 'Resources'
)
foreach ($item in $execItems) {
  $src = Join-Path $execSrc $item
  if (-not (Test-Path $src)) { throw "执行器产物缺失：$src" }
  Copy-Item $src -Destination (Join-Path $execStage $item) -Recurse
}
$execZip = Join-Path $relDir "vtuber-executors-win64-$Version.zip"
Compress-Archive -Path (Join-Path $execStage '*') -DestinationPath $execZip
Remove-Item $execStage -Recurse -Force
Write-Host "  + vtuber-executors-win64-$Version.zip ($([math]::Round((Get-Item $execZip).Length/1MB,1)) MB)"

# ---------- 打包：Node 后端 ----------
$backendZip = Join-Path $relDir "vtuber-backend-$Version.zip"
$backendStage = Join-Path $relDir '_backend'
New-Item $backendStage -ItemType Directory | Out-Null
Copy-Item backend/dist -Destination (Join-Path $backendStage 'dist') -Recurse
Copy-Item backend/renderer -Destination (Join-Path $backendStage 'renderer') -Recurse
Copy-Item backend/package.json -Destination $backendStage
if (Test-Path 'backend/package-lock.json') {
  Copy-Item backend/package-lock.json -Destination $backendStage
}
Compress-Archive -Path (Join-Path $backendStage '*') -DestinationPath $backendZip
Remove-Item $backendStage -Recurse -Force
Write-Host "  + vtuber-backend-$Version.zip ($([math]::Round((Get-Item $backendZip).Length/1MB,2)) MB)"

# ---------- 打包：Koishi 插件（npm pack） ----------
# 经 cmd 调用：避免 PS5.1 把 npm 的 stderr notice 当错误中断脚本
$tgz = (cmd /c "npm pack --pack-destination "$relDir" 2>nul" | Select-Object -Last 1)
Write-Host "  + $tgz"

# ---------- Release Notes ----------
$lastTag = git tag --list 'v*' | Sort-Object { [version]($_ -replace '^v','') } | Select-Object -Last 1
if ($lastTag) {
  $notes = git log --oneline "$lastTag..HEAD"
} else {
  $notes = git log --oneline -20
}
$notesFile = Join-Path $relDir 'RELEASE_NOTES.md'
@"
# $tag

$($notes -join "`n")
"@ | Out-File $notesFile -Encoding utf8
Write-Host "  + RELEASE_NOTES.md"

# ---------- 发布 ----------
Write-Host "`n== 打包完成: $relDir ==" -ForegroundColor Green
$assets = @($execZip, $backendZip, (Join-Path $relDir $tgz)) -join ' '
if (Get-Command gh -ErrorAction SilentlyContinue) {
  $env:HTTPS_PROXY = 'http://127.0.0.1:7890'
  $env:HTTP_PROXY = 'http://127.0.0.1:7890'
  Write-Host "`n检测到 gh CLI，自动创建 Release $tag ..." -ForegroundColor Yellow
  git tag $tag 2>$null
  git -c http.proxy=http://127.0.0.1:7890 push origin $tag
  gh release create $tag $assets --title $tag --notes-file $notesFile
  Write-Host "`n✅ Release 已发布: https://github.com/PinkElysiaDev/Elysia-Vtuber/releases/tag/$tag" -ForegroundColor Green
} else {
  Write-Host @"

gh CLI 未安装。手动发布两步：
  1. 打开 https://github.com/PinkElysiaDev/Elysia-Vtuber/releases/new
     Draft a new release → Tag: $tag（输入后选 create new tag）→ 上传 release/ 下 3 个资产 → Publish
  2. 或安装 gh 后重跑本脚本（-SkipBuild）自动发布：
     winget install GitHub.cli && gh auth login

别忘了推 tag：git tag $tag && git -c http.proxy=http://127.0.0.1:7890 push origin $tag
"@ -ForegroundColor Cyan
}
Pop-Location
