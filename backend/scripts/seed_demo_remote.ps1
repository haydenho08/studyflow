# Seed (or reset) the demo account in a hosted database, e.g. Neon.
#
# The connection string is typed at a hidden prompt and lives only in this process's
# environment for the one command: it never lands in a file, the shell history, or a chat.
#
#   powershell -ExecutionPolicy Bypass -File backend\scripts\seed_demo_remote.ps1

$secure = Read-Host "Paste the database connection string (input is hidden)" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
    $env:DATABASE_URL = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    Push-Location (Join-Path $PSScriptRoot "..")
    & ".\.venv\Scripts\python.exe" -m scripts.seed_demo --tz America/Toronto
}
finally {
    Pop-Location
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
}
