param(
    [string]$Manifest = "data/manifests/v2_production_train_100.json",
    [string]$RawDirectory = "data/raw",
    [string]$ProcessedDirectory = "data/processed_v2_production_100",
    [string]$Config = "configs/v2_production_core.yaml",
    [string]$AuditOutput = "outputs/v2_production_100/data_audit.json"
)

$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$python = Join-Path $repositoryRoot ".venv\Scripts\python.exe"

if (-not (Test-Path -LiteralPath $python)) {
    throw @"
The project virtual environment is not installed. Run:
  py -m venv .venv
  & ".\.venv\Scripts\python.exe" -m pip install -e ".[dev]"
"@
}

Push-Location $repositoryRoot
$secureToken = Read-Host "Paste your Hugging Face token (input is hidden)" -AsSecureString
$tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
try {
    $env:HF_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer)
    & $python -m smart_scan.cli download --manifest $Manifest --output $RawDirectory
    if ($LASTEXITCODE -ne 0) { throw "Dataset download failed" }
    & $python -m smart_scan.cli audit --manifest $Manifest --raw $RawDirectory --output $AuditOutput
    if ($LASTEXITCODE -ne 0) { throw "Dataset audit failed" }
    & $python .\scripts\v2_preprocess.py --manifest $Manifest --raw $RawDirectory --output $ProcessedDirectory --config $Config
    if ($LASTEXITCODE -ne 0) { throw "V2 production preprocessing failed" }
    Write-Host "100 production-training scenarios are ready under $ProcessedDirectory"
}
finally {
    Remove-Item Env:HF_TOKEN -ErrorAction SilentlyContinue
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer)
    Pop-Location
}

