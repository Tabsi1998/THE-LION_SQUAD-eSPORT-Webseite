param(
    [switch]$SkipBackendTests,
    [switch]$SkipFrontendBuild,
    [ValidateSet("Auto", "npm", "yarn", "corepack-yarn")]
    [string]$PackageManager = "Auto"
)

$ErrorActionPreference = "Stop"
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")

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

function Invoke-FrontendBuild {
    Push-Location (Join-Path $repoRoot "frontend")
    try {
        $selectedPackageManager = $PackageManager
        if ($selectedPackageManager -eq "Auto") {
            if (Get-Command yarn -ErrorAction SilentlyContinue) {
                $selectedPackageManager = "yarn"
            } elseif (Get-Command corepack -ErrorAction SilentlyContinue) {
                $selectedPackageManager = "corepack-yarn"
            } else {
                $selectedPackageManager = "npm"
            }
        }

        Write-Host "Paketmanager: $selectedPackageManager" -ForegroundColor DarkGray
        switch ($selectedPackageManager) {
            "yarn" { yarn build }
            "corepack-yarn" { corepack yarn build }
            "npm" { npm run build }
        }
    } finally {
        Pop-Location
    }
}

$pythonFiles = @(
    "backend/services/match_v2_results.py",
    "backend/services/match_notifications.py",
    "backend/routes/friend_routes.py",
    "backend/routes/message_routes.py",
    "backend/routes/team_routes.py",
    "backend/routes/match_routes.py",
    "backend/routes/match_v2_routes.py",
    "backend/routes/phase_ef_routes.py",
    "backend/routes/tournament_routes.py",
    "backend/routes/f1_routes.py",
    "backend/models.py"
) | ForEach-Object { Join-Path $repoRoot $_ }

Run-Step "Backend-Dateien kompilieren" {
    python -m py_compile $pythonFiles
}

if (-not $SkipBackendTests) {
    Run-Step "Kritische Match-V2-Unit-Tests" {
        python -m pytest (Join-Path $repoRoot "backend/tests/test_match_v2_results_unit.py")
    }
}

if (-not $SkipFrontendBuild) {
    Run-Step "Frontend-Build" {
        Invoke-FrontendBuild
    }
}

Write-Host ""
Write-Host "Quick-Check erfolgreich abgeschlossen." -ForegroundColor Green
