param(
    [string]$Manifest = "data/manifests/micro.json",
    [string]$RawDirectory = "data/raw"
)

$ErrorActionPreference = "Stop"
$secureToken = Read-Host "Paste your Hugging Face token (input is hidden)" -AsSecureString
$tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)

try {
    $env:HF_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer)
    & ".venv\Scripts\smart-scan.exe" download --manifest $Manifest --output $RawDirectory
    if ($LASTEXITCODE -ne 0) {
        throw "Dataset download failed with exit code $LASTEXITCODE"
    }
}
finally {
    Remove-Item Env:HF_TOKEN -ErrorAction SilentlyContinue
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer)
}

