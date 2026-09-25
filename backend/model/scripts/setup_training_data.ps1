param(
    [string]$Manifest = "data/manifests/scaled_train_val.json",
    [string]$Config = "configs/scaled.yaml",
    [string]$RawDirectory = "data/raw",
    [string]$ProcessedDirectory = "data/processed",
    [string]$AuditOutput = "outputs/scaled_data_audit.json"
)

$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$smartScan = Join-Path $repositoryRoot ".venv\Scripts\smart-scan.exe"

if (-not (Test-Path -LiteralPath $smartScan)) {
    throw @"
The project virtual environment is not installed. Run these commands first:
  py -m venv .venv
  & ".\.venv\Scripts\python.exe" -m pip install -e ".[dev]"
"@
}

Push-Location $repositoryRoot
$secureToken = Read-Host "Paste your Hugging Face token (input is hidden)" -AsSecureString
$tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)

try {
    $env:HF_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer)
    Write-Host "Downloading only the files declared in $Manifest"
    & $smartScan download --manifest $Manifest --output $RawDirectory
    if ($LASTEXITCODE -ne 0) { throw "Dataset download failed with exit code $LASTEXITCODE" }

    Write-Host "Auditing downloaded scenario files"
    & $smartScan audit --manifest $Manifest --raw $RawDirectory --output $AuditOutput
    if ($LASTEXITCODE -ne 0) { throw "Dataset audit failed with exit code $LASTEXITCODE" }

    Write-Host "Preprocessing scenarios into time-frequency episodes"
    & $smartScan preprocess --manifest $Manifest --raw $RawDirectory --output $ProcessedDirectory --config $Config
    if ($LASTEXITCODE -ne 0) { throw "Dataset preprocessing failed with exit code $LASTEXITCODE" }

    Write-Host "Training data is ready under $ProcessedDirectory"
}
finally {
    Remove-Item Env:HF_TOKEN -ErrorAction SilentlyContinue
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer)
    Pop-Location
}
