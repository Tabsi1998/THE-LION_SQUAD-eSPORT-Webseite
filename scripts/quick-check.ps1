param(
    [switch]$SkipBackendTests,
    [switch]$SkipFrontendBuild,
    [switch]$SkipMobileTypecheck,
    [switch]$SkipAudits,
    [switch]$SkipE2E,
    [switch]$SkipExpoChecks,
    [ValidateSet("Auto", "npm", "yarn", "corepack-yarn")]
    [string]$PackageManager = "Auto"
)

$ErrorActionPreference = "Stop"
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")

$selectedPackageManager = $PackageManager
if ($selectedPackageManager -eq "Auto") {
    if (Get-Command yarn -ErrorAction SilentlyContinue) {
        $selectedPackageManager = "yarn"
    } elseif (Get-Command corepack -ErrorAction SilentlyContinue) {
        $selectedPackageManager = "corepack-yarn"
    } else {
        throw "Yarn 1.22 oder Corepack wird fuer den eingefrorenen frontend/yarn.lock benoetigt."
    }
}
if ($selectedPackageManager -eq "npm") {
    throw "Das Frontend verwendet ausschliesslich yarn.lock; bitte -PackageManager yarn oder corepack-yarn verwenden."
}

function Run-Step {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][scriptblock]$Command
    )

    Write-Host ""
    Write-Host "==> $Name" -ForegroundColor Cyan
    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "$Name fehlgeschlagen mit Exitcode $LASTEXITCODE"
    }
}

function Invoke-Yarn {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
    if ($selectedPackageManager -eq "corepack-yarn") {
        & corepack yarn @Arguments
    } else {
        & yarn @Arguments
    }
}

$env:APP_ENV = "test"
$env:MONGO_URL = "mongodb://127.0.0.1:27017"
$env:DB_NAME = "tls_local_check"
$env:DISABLE_SCHEDULER = "true"
$env:UPLOAD_DIR = Join-Path ([System.IO.Path]::GetTempPath()) "tls-local-check-$PID"

Run-Step "Backend vollstaendig kompilieren" {
    Push-Location $repoRoot
    try {
        python -m compileall -q backend
    } finally {
        Pop-Location
    }
}

if (-not $SkipAudits) {
    Run-Step "Backend-Abhaengigkeiten auditieren" {
        Push-Location $repoRoot
        try {
            python -m pip_audit -r backend/requirements.txt
        } finally {
            Pop-Location
        }
    }
}

if (-not $SkipBackendTests) {
    Run-Step "Backend-Tests ohne Live-System" {
        Push-Location $repoRoot
        try {
            python -m pytest -m "not live"
        } finally {
            Pop-Location
        }
    }
}

if (-not $SkipFrontendBuild) {
    if (-not $SkipAudits) {
        Run-Step "Frontend-Abhaengigkeiten auditieren" {
            Push-Location (Join-Path $repoRoot "frontend")
            try {
                Invoke-Yarn audit:high
            } finally {
                Pop-Location
            }
        }
    }
    Run-Step "Frontend-Build" {
        Push-Location (Join-Path $repoRoot "frontend")
        try {
            Invoke-Yarn build
        } finally {
            Pop-Location
        }
    }
    Run-Step "Frontend-Unit-Tests" {
        Push-Location (Join-Path $repoRoot "frontend")
        try {
            Invoke-Yarn test --watchAll=false --passWithNoTests
        } finally {
            Pop-Location
        }
    }
    if (-not $SkipE2E) {
        Run-Step "Playwright-Chromium vorbereiten" {
            Push-Location (Join-Path $repoRoot "frontend")
            try {
                Invoke-Yarn playwright install chromium
            } finally {
                Pop-Location
            }
        }
        Run-Step "Frontend-Browser-Smoke-Tests" {
            Push-Location (Join-Path $repoRoot "frontend")
            try {
                Invoke-Yarn test:e2e
            } finally {
                Pop-Location
            }
        }
    }
}

if (-not $SkipMobileTypecheck) {
    if (-not $SkipAudits) {
        Run-Step "Mobile-Abhaengigkeiten auditieren" {
            Push-Location (Join-Path $repoRoot "mobile")
            try {
                npm audit --audit-level=moderate
            } finally {
                Pop-Location
            }
        }
    }
    Run-Step "Mobile-Typecheck" {
        Push-Location (Join-Path $repoRoot "mobile")
        try {
            npm run typecheck
        } finally {
            Pop-Location
        }
    }
    Run-Step "Mobile-Sicherheitsregressionen" {
        Push-Location (Join-Path $repoRoot "mobile")
        try {
            npm run test:security
        } finally {
            Pop-Location
        }
    }
    Run-Step "Mobile-Release-Preflight" {
        Push-Location (Join-Path $repoRoot "mobile")
        try {
            npm run release:preflight
        } finally {
            Pop-Location
        }
    }
    if (-not $SkipExpoChecks) {
        Run-Step "Expo-Konfiguration pruefen" {
            Push-Location (Join-Path $repoRoot "mobile")
            try {
                npx expo install --check
                if ($LASTEXITCODE -eq 0) { npx expo-doctor }
            } finally {
                Pop-Location
            }
        }
    }
}

Write-Host ""
Write-Host "Lokale CI-Matrix erfolgreich abgeschlossen." -ForegroundColor Green
