[CmdletBinding()]
param(
    [ValidateSet("Start", "Stop", "Restart", "Verify", "RefreshBackend")]
    [string]$Action = "Start"
)

# LOCAL-DEV LIFESPAN SAFETY RULE:
# The managed backend intentionally runs with --lifespan off so ordinary local
# startup cannot seed or reconcile canonical RBAC data. Before backend startup
# this script verifies the current lifespan RBAC postconditions read-only from
# canonical source + canonical DB. Re-audit this gate before accepting any
# future mandatory initialization added to app.main.lifespan.

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$FrontendWorktree = $PSScriptRoot
$FrontendRoot = Join-Path $FrontendWorktree "frontend"
$HqWorktree = [System.IO.Path]::GetFullPath(
    (Join-Path $FrontendWorktree "..\Marjon-hq-admin")
)
$HqFrontendRoot = Join-Path $HqWorktree "frontend"
$CanonicalBackendRoot = [System.IO.Path]::GetFullPath(
    (Join-Path $FrontendWorktree "..\Marjon-backend-integration")
)
$BackendContext = Join-Path $CanonicalBackendRoot "backend"
$LocalEnvFile = Join-Path $FrontendWorktree ".marjon-dev.env"
$StateRoot = Join-Path $FrontendWorktree ".marjon-dev"
$FrontendPidFile = Join-Path $StateRoot "frontend.pid"
$FrontendStdout = Join-Path $StateRoot "frontend.stdout.log"
$FrontendStderr = Join-Path $StateRoot "frontend.stderr.log"
$HqPidFile = Join-Path $StateRoot "hq-frontend.pid"
$HqStdout = Join-Path $StateRoot "hq-frontend.stdout.log"
$HqStderr = Join-Path $StateRoot "hq-frontend.stderr.log"

$BackendContainer = "marjon-canonical-backend-dev"
$DatabaseContainer = "marjon-db-1"
$WrongBackendContainer = "marjon-frontend-prerbac-backend-1"
$CanonicalBackendBranch = "backend-integration-v1"
$NetworkName = "marjon_default"
$DatabaseName = "marjon_authoritative"
$DatabaseUser = "marjon"
$FrontendPort = 5173
$HqPort = 5174
$BackendPort = 8000
$FrontendUrl = "http://localhost:5173"
$HqOrigin = "http://localhost:5174"
$HqUrl = "$HqOrigin/admin.html"
$BackendUrl = "http://localhost:8000"

function Write-Step {
    param([string]$Message)
    Write-Host "[marjon-dev] $Message"
}

function Stop-WithDiagnostic {
    param([string]$Message)
    throw "MARJON DEV PRECHECK FAILED: $Message"
}

function Invoke-Docker {
    param([Parameter(Mandatory)][string[]]$Arguments)
    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        $output = @(& docker @Arguments 2>&1)
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    if ($exitCode -ne 0) {
        Stop-WithDiagnostic "docker $($Arguments -join ' ') failed: $($output -join ' ')"
    }
    return $output
}

function Get-ObjectPropertyValue {
    param([object]$Object, [string]$Name)
    if ($null -eq $Object) { return $null }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }
    return $property.Value
}

function Get-ContainerInspect {
    param([string]$Name)
    $json = @(& docker container inspect $Name 2>$null)
    if ($LASTEXITCODE -ne 0) { return $null }
    return @(($json -join "`n") | ConvertFrom-Json)[0]
}

function Get-ImageInspect {
    param([string]$Name)
    $json = @(& docker image inspect $Name 2>$null)
    if ($LASTEXITCODE -ne 0) { return $null }
    return @(($json -join "`n") | ConvertFrom-Json)[0]
}

function Get-ContainerEnvValue {
    param([object]$Container, [string]$Name)
    $prefix = "$Name="
    $entry = @($Container.Config.Env | Where-Object { $_.StartsWith($prefix) }) | Select-Object -First 1
    if (-not $entry) { return $null }
    return $entry.Substring($prefix.Length)
}

function Assert-Tooling {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        Stop-WithDiagnostic "Docker CLI is not available."
    }
    [void](Invoke-Docker -Arguments @("version", "--format", "{{.Server.Version}}"))

    foreach ($path in @($CanonicalBackendRoot, $BackendContext, $FrontendRoot, $HqFrontendRoot)) {
        if (-not (Test-Path -LiteralPath $path -PathType Container)) {
            Stop-WithDiagnostic "Required directory is missing: $path"
        }
    }
}

function Read-LocalEnv {
    if (-not (Test-Path -LiteralPath $LocalEnvFile -PathType Leaf)) {
        Stop-WithDiagnostic "Missing ignored local config: $LocalEnvFile. Copy .marjon-dev.env.example and fill it."
    }

    $values = @{}
    foreach ($line in Get-Content -LiteralPath $LocalEnvFile) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith("#")) { continue }
        $parts = $trimmed -split "=", 2
        if ($parts.Count -ne 2) {
            Stop-WithDiagnostic "Invalid line in .marjon-dev.env (expected KEY=VALUE)."
        }
        $key = $parts[0].Trim()
        $value = $parts[1].Trim()
        if (
            $value.Length -ge 2 -and
            (($value.StartsWith('"') -and $value.EndsWith('"')) -or
             ($value.StartsWith("'") -and $value.EndsWith("'")))
        ) {
            $value = $value.Substring(1, $value.Length - 2)
        }
        $values[$key] = $value
    }
    return $values
}

function Get-DatabaseTarget {
    param([string]$DatabaseUrl)
    if (-not $DatabaseUrl) {
        Stop-WithDiagnostic "DATABASE_URL is required in .marjon-dev.env."
    }
    $pattern = '^postgresql\+asyncpg://.+@(?<host>[^:/?#]+)(?::(?<port>\d+))?/(?<database>[^/?#]+)(?:[?#].*)?$'
    if ($DatabaseUrl -notmatch $pattern) {
        Stop-WithDiagnostic "DATABASE_URL must be an explicit postgresql+asyncpg URL."
    }
    return [pscustomobject]@{
        Host = $Matches.host
        Database = [System.Uri]::UnescapeDataString($Matches.database)
    }
}

function Assert-LocalEnv {
    param([hashtable]$Values)
    foreach ($required in @("DATABASE_URL", "SECRET_KEY", "ALLOWED_ORIGINS")) {
        if (-not $Values.ContainsKey($required) -or -not $Values[$required]) {
            Stop-WithDiagnostic "$required is required in .marjon-dev.env."
        }
    }

    $target = Get-DatabaseTarget -DatabaseUrl $Values.DATABASE_URL
    if ($target.Database -ne $DatabaseName) {
        Stop-WithDiagnostic "DATABASE_URL database must be exactly '$DatabaseName'; got '$($target.Database)'."
    }
    if ($target.Host -ne "db") {
        Stop-WithDiagnostic "DATABASE_URL host must be Docker alias 'db'; got '$($target.Host)'."
    }
    if ($Values.SECRET_KEY -match "CHANGE_ME" -or $Values.SECRET_KEY.Length -lt 32) {
        Stop-WithDiagnostic "SECRET_KEY must be a non-placeholder local secret of at least 32 characters."
    }

    try {
        $parsedOrigins = ConvertFrom-Json -InputObject $Values.ALLOWED_ORIGINS -ErrorAction Stop
        $origins = @($parsedOrigins | ForEach-Object { [string]$_ })
    } catch {
        Stop-WithDiagnostic "ALLOWED_ORIGINS must be a JSON array, for example [\"http://localhost:5173\"]."
    }
    if ($origins.Count -eq 0) {
        Stop-WithDiagnostic "ALLOWED_ORIGINS must contain at least one explicit origin."
    }
    if ($origins -contains "*") {
        Stop-WithDiagnostic "Wildcard CORS origin is forbidden."
    }
    if ($origins -notcontains $FrontendUrl) {
        Stop-WithDiagnostic "ALLOWED_ORIGINS must include $FrontendUrl."
    }
    if ($origins -notcontains $HqOrigin) {
        Stop-WithDiagnostic "ALLOWED_ORIGINS must include $HqOrigin."
    }

    Write-Step "Local config valid: DB host=db, database=$DatabaseName, CORS=$($origins -join ',') (credentials redacted)."
}

function Get-CanonicalGitHead {
    $safeDirectory = $CanonicalBackendRoot.Replace("\", "/")
    $topLevel = @(& git -c "safe.directory=$safeDirectory" -C $CanonicalBackendRoot rev-parse --show-toplevel 2>&1)
    if ($LASTEXITCODE -ne 0 -or $topLevel.Count -ne 1) {
        Stop-WithDiagnostic "Canonical backend path is not a readable Git worktree: $CanonicalBackendRoot."
    }
    $actualRoot = [System.IO.Path]::GetFullPath($topLevel[0].Trim().Replace("/", "\")).TrimEnd("\")
    $expectedRoot = [System.IO.Path]::GetFullPath($CanonicalBackendRoot).TrimEnd("\")
    if (-not [string]::Equals($actualRoot, $expectedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        Stop-WithDiagnostic "Canonical backend worktree root mismatch: expected $expectedRoot; got $actualRoot."
    }

    $branch = @(& git -c "safe.directory=$safeDirectory" -C $CanonicalBackendRoot branch --show-current 2>&1)
    if ($LASTEXITCODE -ne 0 -or $branch.Count -ne 1 -or $branch[0].Trim() -ne $CanonicalBackendBranch) {
        Stop-WithDiagnostic "Canonical backend branch must be '$CanonicalBackendBranch'; got '$($branch -join ' ')'."
    }

    $dirty = @(& git -c "safe.directory=$safeDirectory" -C $CanonicalBackendRoot status --porcelain --untracked-files=all 2>&1)
    if ($LASTEXITCODE -ne 0) {
        Stop-WithDiagnostic "Cannot verify canonical backend worktree cleanliness: $($dirty -join ' ')"
    }
    if ($dirty.Count -gt 0) {
        Stop-WithDiagnostic "Canonical backend worktree is dirty; refusing to build unknown code: $($dirty -join ', ')"
    }

    $head = @(& git -c "safe.directory=$safeDirectory" -C $CanonicalBackendRoot rev-parse HEAD 2>&1)
    if ($LASTEXITCODE -ne 0 -or $head.Count -ne 1) {
        Stop-WithDiagnostic "Cannot determine canonical backend Git HEAD: $($head -join ' ')"
    }
    Write-Step "Canonical worktree verified: branch=$CanonicalBackendBranch, clean, HEAD=$($head[0].Trim())."
    return $head[0].Trim()
}

function Get-MigrationHead {
    $versionsPath = Join-Path $BackendContext "migrations\versions"
    $files = @(Get-ChildItem -LiteralPath $versionsPath -Filter "*.py")
    if ($files.Count -eq 0) {
        Stop-WithDiagnostic "No canonical migration files found in $versionsPath."
    }

    $revisions = @{}
    $downRefs = New-Object System.Collections.Generic.HashSet[string]
    foreach ($file in $files) {
        $content = Get-Content -LiteralPath $file.FullName -Raw
        $revisionMatch = [regex]::Match(
            $content,
            '(?m)^revision\s*(?::[^=]+)?=\s*["'']([^"'']+)["'']'
        )
        if (-not $revisionMatch.Success) { continue }
        $revision = $revisionMatch.Groups[1].Value
        $revisions[$revision] = $file.Name

        $downMatch = [regex]::Match(
            $content,
            '(?ms)^down_revision\s*(?::[^=]+)?=\s*(.+?)(?:\r?\n[^ \t]|\z)'
        )
        if ($downMatch.Success) {
            foreach ($match in [regex]::Matches($downMatch.Groups[1].Value, '["'']([^"'']+)["'']')) {
                [void]$downRefs.Add($match.Groups[1].Value)
            }
        }
    }

    $heads = @($revisions.Keys | Where-Object { -not $downRefs.Contains($_) } | Sort-Object)
    if ($heads.Count -ne 1) {
        Stop-WithDiagnostic "Canonical migration graph must have exactly one head; found $($heads.Count)."
    }
    return $heads[0]
}

function Wait-ForDatabase {
    for ($attempt = 1; $attempt -le 30; $attempt++) {
        $container = Get-ContainerInspect -Name $DatabaseContainer
        if ($container -and $container.State.Running) {
            $health = Get-ObjectPropertyValue -Object $container.State -Name "Health"
            if ($null -eq $health -or $health.Status -eq "healthy") { return }
        }
        Start-Sleep -Seconds 1
    }
    Stop-WithDiagnostic "$DatabaseContainer did not become ready within 30 seconds."
}

function Assert-CanonicalDatabaseContainer {
    param([switch]$StartIfStopped)
    $container = Get-ContainerInspect -Name $DatabaseContainer
    if (-not $container) {
        Stop-WithDiagnostic "$DatabaseContainer does not exist. Refusing to create a second PostgreSQL instance."
    }

    $networkProperty = $container.NetworkSettings.Networks.PSObject.Properties[$NetworkName]
    if ($null -eq $networkProperty) {
        Stop-WithDiagnostic "$DatabaseContainer is not attached to $NetworkName."
    }
    $aliases = @($networkProperty.Value.Aliases)
    if ($aliases -notcontains "db") {
        Stop-WithDiagnostic "$DatabaseContainer has no 'db' alias on $NetworkName."
    }

    if (-not $container.State.Running) {
        if (-not $StartIfStopped) {
            Stop-WithDiagnostic "$DatabaseContainer is not running."
        }
        Write-Step "Starting existing canonical DB container $DatabaseContainer (no recreate)."
        [void](Invoke-Docker -Arguments @("start", $DatabaseContainer))
    }
    Wait-ForDatabase
}

function Invoke-PsqlScalar {
    param([string]$Database, [string]$Sql)
    $wrapped = "BEGIN TRANSACTION READ ONLY;`n$Sql`nCOMMIT;"
    $output = @(
        @(Invoke-Docker -Arguments @(
            "exec", $DatabaseContainer,
            "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1",
            "-U", $DatabaseUser, "-d", $Database, "-c", $wrapped
        )) | Where-Object { $_ -and $_.Trim() }
    )
    if ($output.Count -ne 1) {
        Stop-WithDiagnostic "Expected one scalar from read-only PostgreSQL check; got: $($output -join ' ')"
    }
    return $output[0].Trim()
}

function Convert-ToSqlLiteral {
    param([Parameter(Mandatory)][string]$Value)
    return "'" + $Value.Replace("'", "''") + "'"
}

function Get-CanonicalRbacExpectations {
    $sourcePath = Join-Path $BackendContext "app\modules\rbac\permissions.py"
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
        Stop-WithDiagnostic "Canonical RBAC source is missing: $sourcePath"
    }
    $source = Get-Content -LiteralPath $sourcePath -Raw

    $permissionsBlock = [regex]::Match(
        $source,
        '(?ms)^DEFAULT_PERMISSIONS\s*(?::[^=]+)?=\s*\[(?<body>.*?)^\]'
    )
    if (-not $permissionsBlock.Success) {
        Stop-WithDiagnostic "Cannot read DEFAULT_PERMISSIONS from canonical source; re-audit the lifespan safety gate."
    }
    $permissionMatches = [regex]::Matches(
        $permissionsBlock.Groups["body"].Value,
        '\(\s*["''](?<module>[^"'']+)["'']\s*,\s*["''](?<action>[^"'']+)["'']\s*,\s*["''](?<scope>[^"'']+)["'']\s*\)'
    )
    $permissions = @($permissionMatches | ForEach-Object {
        [pscustomobject]@{
            Module = $_.Groups["module"].Value
            Action = $_.Groups["action"].Value
            Scope = $_.Groups["scope"].Value
        }
    })
    if ($permissions.Count -eq 0) {
        Stop-WithDiagnostic "Canonical DEFAULT_PERMISSIONS is empty or unreadable."
    }
    $permissionKeys = @($permissions | ForEach-Object { "$($_.Module)|$($_.Action)|$($_.Scope)" })
    if (@($permissionKeys | Sort-Object -Unique).Count -ne $permissionKeys.Count) {
        Stop-WithDiagnostic "Canonical DEFAULT_PERMISSIONS contains duplicate keys."
    }

    $roleBlock = [regex]::Match(
        $source,
        '(?ms)^DEFAULT_ROLE_PERMISSIONS\s*(?::[^=]+)?=\s*\{(?<body>.*?)^\}'
    )
    if (-not $roleBlock.Success) {
        Stop-WithDiagnostic "Cannot read DEFAULT_ROLE_PERMISSIONS from canonical source; re-audit the lifespan safety gate."
    }
    $roles = @{}
    $currentSlug = $null
    $currentWanted = $null
    foreach ($line in @($roleBlock.Groups["body"].Value -split '\r?\n')) {
        if ($null -eq $currentSlug) {
            if ($line -match '^\s{4}["''](?<slug>[^"'']+)["'']\s*:\s*\[\s*\],?\s*$') {
                $roles[$Matches.slug] = @()
                continue
            }
            if ($line -match '^\s{4}["''](?<slug>[^"'']+)["'']\s*:\s*\[\s*$') {
                $currentSlug = $Matches.slug
                $currentWanted = New-Object System.Collections.Generic.List[string]
            }
            continue
        }
        if ($line -match '^\s{4}\],?\s*$') {
            $roles[$currentSlug] = @($currentWanted)
            $currentSlug = $null
            $currentWanted = $null
            continue
        }
        foreach ($match in [regex]::Matches($line, '["''](?<permission>[^"'']+)["'']')) {
            $currentWanted.Add($match.Groups["permission"].Value)
        }
    }
    if ($null -ne $currentSlug -or $roles.Count -eq 0) {
        Stop-WithDiagnostic "Canonical DEFAULT_ROLE_PERMISSIONS structure is unsupported; re-audit instead of guessing."
    }

    foreach ($slug in @($roles.Keys)) {
        $wanted = @($roles[$slug])
        if ($wanted -contains "*") {
            Stop-WithDiagnostic "Wildcard role defaults require a lifespan safety-gate re-audit; role=$slug."
        }
        foreach ($permission in $wanted) {
            if ($permission -notmatch '^(?<module>[^:]+):(?<action>.+)$') {
                Stop-WithDiagnostic "Unsupported canonical role permission key '$permission' for role '$slug'."
            }
        }
    }
    if (-not $roles.ContainsKey("owner") -or -not $roles.ContainsKey("admin")) {
        Stop-WithDiagnostic "Canonical owner/admin role defaults are missing; re-audit the lifespan safety gate."
    }

    return [pscustomobject]@{
        Permissions = $permissions
        Roles = $roles
    }
}

function Assert-CanonicalRbacState {
    $tablesReady = Invoke-PsqlScalar -Database $DatabaseName -Sql @"
SELECT CASE WHEN
    to_regclass('public.permissions') IS NOT NULL
    AND to_regclass('public.roles') IS NOT NULL
    AND to_regclass('public.role_permissions') IS NOT NULL
THEN 'yes' ELSE 'no' END;
"@
    if ($tablesReady -ne "yes") {
        Stop-WithDiagnostic "Canonical RBAC tables permissions/roles/role_permissions must already exist. No seed or migration was run."
    }

    $expected = Get-CanonicalRbacExpectations
    $permissionValues = @($expected.Permissions | ForEach-Object {
        "($(Convert-ToSqlLiteral $_.Module), $(Convert-ToSqlLiteral $_.Action), $(Convert-ToSqlLiteral $_.Scope))"
    }) -join ",`n"
    $missingPermissions = Invoke-PsqlScalar -Database $DatabaseName -Sql @"
WITH expected(module, action, scope) AS (
    VALUES $permissionValues
)
SELECT count(*)
FROM expected e
LEFT JOIN permissions p
  ON p.module=e.module AND p.action=e.action AND p.scope=e.scope
WHERE p.id IS NULL;
"@
    if ([int]$missingPermissions -ne 0) {
        Stop-WithDiagnostic "Canonical RBAC permission seed is incomplete: $missingPermissions expected permission(s) missing. Lifespan remains off; nothing was changed."
    }

    $ownerCount = Invoke-PsqlScalar -Database $DatabaseName -Sql @"
SELECT count(*) FROM roles
WHERE slug='owner' AND company_id IS NOT NULL AND NOT is_system;
"@
    if ([int]$ownerCount -eq 0) {
        Stop-WithDiagnostic "No canonical company OWNER role exists. Lifespan remains off; nothing was changed."
    }

    $ownerValues = @($expected.Roles["owner"] | ForEach-Object {
        if ($_ -notmatch '^(?<module>[^:]+):(?<action>.+)$') {
            Stop-WithDiagnostic "Unsupported canonical OWNER permission key: $_"
        }
        "($(Convert-ToSqlLiteral $Matches.module), $(Convert-ToSqlLiteral $Matches.action))"
    }) -join ",`n"
    $ownerDelta = Invoke-PsqlScalar -Database $DatabaseName -Sql @"
WITH expected(module, action) AS (
    VALUES $ownerValues
), desired_permissions AS (
    SELECT p.id AS permission_id
    FROM permissions p
    JOIN expected e ON e.module=p.module AND e.action=p.action
), owners AS (
    SELECT id AS role_id FROM roles
    WHERE slug='owner' AND company_id IS NOT NULL AND NOT is_system
), expected_links AS (
    SELECT o.role_id, p.permission_id FROM owners o CROSS JOIN desired_permissions p
), actual_links AS (
    SELECT o.role_id, rp.permission_id
    FROM owners o JOIN role_permissions rp ON rp.role_id=o.role_id
)
SELECT
    (SELECT count(*) FROM expected_links e
     LEFT JOIN actual_links a USING (role_id, permission_id)
     WHERE a.role_id IS NULL)
  + (SELECT count(*) FROM actual_links a
     LEFT JOIN expected_links e USING (role_id, permission_id)
     WHERE e.role_id IS NULL);
"@
    if ([int]$ownerDelta -ne 0) {
        Stop-WithDiagnostic "Canonical OWNER role permissions differ from the current source by $ownerDelta relationship(s). Lifespan remains off; nothing was reconciled."
    }

    $adminDelta = Invoke-PsqlScalar -Database $DatabaseName -Sql @"
SELECT count(*)
FROM roles r JOIN role_permissions rp ON rp.role_id=r.id
WHERE r.slug='admin' AND r.company_id IS NOT NULL AND NOT r.is_system;
"@
    if ([int]$adminDelta -ne 0) {
        Stop-WithDiagnostic "Legacy company admin role has $adminDelta permission relationship(s) pending removal. Lifespan remains off; nothing was reconciled."
    }

    $operationalDefaults = New-Object System.Collections.Generic.List[string]
    foreach ($slug in @($expected.Roles.Keys | Sort-Object)) {
        if ($slug -in @("owner", "admin")) { continue }
        foreach ($permission in @($expected.Roles[$slug])) {
            if ($permission -notmatch '^(?<module>[^:]+):(?<action>.+)$') {
                Stop-WithDiagnostic "Unsupported canonical role permission key '$permission' for role '$slug'."
            }
            $operationalDefaults.Add(
                "($(Convert-ToSqlLiteral $slug), $(Convert-ToSqlLiteral $Matches.module), $(Convert-ToSqlLiteral $Matches.action))"
            )
        }
    }
    if ($operationalDefaults.Count -gt 0) {
        $operationalValues = @($operationalDefaults) -join ",`n"
        $missingRoleLinks = Invoke-PsqlScalar -Database $DatabaseName -Sql @"
WITH expected(slug, module, action) AS (
    VALUES $operationalValues
), desired_links AS (
    SELECT r.id AS role_id, p.id AS permission_id
    FROM roles r
    JOIN expected e ON e.slug=r.slug
    JOIN permissions p ON p.module=e.module AND p.action=e.action
    WHERE r.company_id IS NOT NULL AND NOT r.is_system
)
SELECT count(*)
FROM desired_links d
LEFT JOIN role_permissions rp
  ON rp.role_id=d.role_id AND rp.permission_id=d.permission_id
WHERE rp.role_id IS NULL;
"@
        if ([int]$missingRoleLinks -ne 0) {
            Stop-WithDiagnostic "Canonical operational roles have $missingRoleLinks missing default relationship(s). Lifespan remains off; nothing was backfilled."
        }
    }

    Write-Step "Read-only RBAC gate passed: canonical permissions present; OWNER exact; no pending admin/default backfill detected."
    Write-Warning "Backend lifespan is intentionally OFF: startup RBAC seed/reconciliation is skipped. Re-audit this read-only gate whenever app.main.lifespan or canonical RBAC defaults change."
}

function Assert-DatabaseAndMigration {
    $exists = Invoke-PsqlScalar -Database "postgres" -Sql (
        "SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_database WHERE datname='$DatabaseName') THEN 'yes' ELSE 'no' END;"
    )
    if ($exists -ne "yes") {
        Stop-WithDiagnostic "Database '$DatabaseName' does not exist in $DatabaseContainer."
    }

    $databaseRevision = Invoke-PsqlScalar -Database $DatabaseName -Sql "SELECT version_num FROM alembic_version;"
    $codeRevision = Get-MigrationHead
    if ($databaseRevision -ne $codeRevision) {
        Stop-WithDiagnostic "Migration mismatch: DB=$databaseRevision, canonical code=$codeRevision. No migration was run."
    }
    Write-Step "Migration revisions match: $codeRevision. Alembic will not run."
}

function Get-DockerPortOwners {
    param([int]$Port)
    $owners = New-Object System.Collections.Generic.List[string]
    foreach ($line in @(Invoke-Docker -Arguments @("ps", "--format", "{{.Names}}|{{.Ports}}"))) {
        $parts = $line -split "\|", 2
        if ($parts.Count -eq 2 -and $parts[1] -match "${Port}->") {
            if (-not $owners.Contains($parts[0])) { $owners.Add($parts[0]) }
        }
    }
    return @($owners)
}

function Get-HostPortListeners {
    param([int]$Port)
    try {
        return @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop)
    } catch [Microsoft.PowerShell.Cmdletization.Cim.CimJobException] {
        return @()
    }
}

function Assert-WrongBackendStopped {
    $wrong = Get-ContainerInspect -Name $WrongBackendContainer
    if ($wrong -and $wrong.State.Running) {
        Stop-WithDiagnostic "$WrongBackendContainer is running. Stop it explicitly; this script will not kill unexpected runtimes."
    }
}

function Assert-BackendPortAvailable {
    $owners = @(Get-DockerPortOwners -Port $BackendPort)
    if ($owners.Count -gt 0) {
        if ($owners.Count -eq 1 -and $owners[0] -eq $BackendContainer) { return }
        Stop-WithDiagnostic "Port $BackendPort is owned by unexpected Docker container(s): $($owners -join ', '). Nothing was stopped."
    }
    $listeners = @(Get-HostPortListeners -Port $BackendPort)
    if ($listeners.Count -gt 0) {
        $pids = @($listeners.OwningProcess | Sort-Object -Unique)
        Stop-WithDiagnostic "Port $BackendPort has an unexpected host listener (PID: $($pids -join ', ')). Nothing was stopped."
    }
}

function Assert-BackendContainerConfig {
    param([object]$Container, [string]$GitHead, [hashtable]$EnvValues)
    $role = Get-ObjectPropertyValue -Object $Container.Config.Labels -Name "com.marjon.runtime.role"
    $revision = Get-ObjectPropertyValue -Object $Container.Config.Labels -Name "org.opencontainers.image.revision"
    $databaseLabel = Get-ObjectPropertyValue -Object $Container.Config.Labels -Name "com.marjon.runtime.database"
    if ($role -ne "canonical-backend" -or $databaseLabel -ne $DatabaseName) {
        Stop-WithDiagnostic "$BackendContainer identity labels do not match the managed canonical backend/database."
    }
    if ($revision -ne $GitHead) {
        Stop-WithDiagnostic "$BackendContainer is stale: container revision=$revision, canonical HEAD=$GitHead. Normal Start will not rebuild; run -Action RefreshBackend explicitly."
    }

    $runtimeUrl = Get-ContainerEnvValue -Container $Container -Name "DATABASE_URL"
    $target = Get-DatabaseTarget -DatabaseUrl $runtimeUrl
    if ($target.Host -ne "db" -or $target.Database -ne $DatabaseName) {
        Stop-WithDiagnostic "$BackendContainer DATABASE_URL does not target db/$DatabaseName."
    }
    if ($runtimeUrl -ne $EnvValues.DATABASE_URL) {
        Stop-WithDiagnostic "$BackendContainer DATABASE_URL differs from ignored local config."
    }

    $runtimeOrigins = Get-ContainerEnvValue -Container $Container -Name "ALLOWED_ORIGINS"
    if ($runtimeOrigins -ne $EnvValues.ALLOWED_ORIGINS) {
        Stop-WithDiagnostic "$BackendContainer ALLOWED_ORIGINS differs from ignored local config."
    }

    $command = @($Container.Config.Cmd) -join " "
    if ($command -notmatch "uvicorn app\.main:app" -or $command -notmatch "--lifespan off" -or $command -match "alembic") {
        Stop-WithDiagnostic "$BackendContainer command must be direct uvicorn with --lifespan off and no Alembic."
    }

    $networkProperty = $Container.NetworkSettings.Networks.PSObject.Properties[$NetworkName]
    if ($null -eq $networkProperty) {
        Stop-WithDiagnostic "$BackendContainer is not attached to $NetworkName."
    }
    if ($Container.HostConfig.RestartPolicy.Name -ne "unless-stopped") {
        Stop-WithDiagnostic "$BackendContainer restart policy must be unless-stopped."
    }

    $bindingProperty = $Container.HostConfig.PortBindings.PSObject.Properties["8000/tcp"]
    if ($null -eq $bindingProperty -or @($bindingProperty.Value)[0].HostPort -ne "8000") {
        Stop-WithDiagnostic "$BackendContainer must publish host port 8000."
    }
}

function Assert-ManagedBackendContainerOwnership {
    param([object]$Container)
    if (-not $Container) {
        Stop-WithDiagnostic "$BackendContainer does not exist."
    }
    $role = Get-ObjectPropertyValue -Object $Container.Config.Labels -Name "com.marjon.runtime.role"
    $databaseLabel = Get-ObjectPropertyValue -Object $Container.Config.Labels -Name "com.marjon.runtime.database"
    $sourceLabel = Get-ObjectPropertyValue -Object $Container.Config.Labels -Name "com.marjon.runtime.source-worktree"
    if (
        $role -ne "canonical-backend" -or
        $databaseLabel -ne $DatabaseName -or
        -not [string]::Equals($sourceLabel, $CanonicalBackendRoot, [System.StringComparison]::OrdinalIgnoreCase)
    ) {
        Stop-WithDiagnostic "$BackendContainer is not the explicitly managed canonical stateless backend. Nothing was replaced."
    }
    if (@($Container.Mounts).Count -ne 0) {
        Stop-WithDiagnostic "$BackendContainer has mounts/volumes and is not safely stateless. Nothing was replaced."
    }
    $networkProperty = $Container.NetworkSettings.Networks.PSObject.Properties[$NetworkName]
    if ($null -eq $networkProperty) {
        Stop-WithDiagnostic "$BackendContainer is not attached to canonical network $NetworkName. Nothing was replaced."
    }
    $runtimeUrl = Get-ContainerEnvValue -Container $Container -Name "DATABASE_URL"
    $target = Get-DatabaseTarget -DatabaseUrl $runtimeUrl
    if ($target.Host -ne "db" -or $target.Database -ne $DatabaseName) {
        Stop-WithDiagnostic "$BackendContainer does not target db/$DatabaseName. Nothing was replaced."
    }
}

function Ensure-CanonicalImage {
    param([string]$GitHead, [switch]$ForceBuild)
    $shortHead = $GitHead.Substring(0, 7)
    $imageName = "marjon-canonical-backend:$shortHead"
    $image = Get-ImageInspect -Name $imageName
    $imageRevision = if ($image) {
        $imageLabels = Get-ObjectPropertyValue -Object $image.Config -Name "Labels"
        Get-ObjectPropertyValue -Object $imageLabels -Name "org.opencontainers.image.revision"
    } else { $null }

    if ($ForceBuild -or -not $image -or $imageRevision -ne $GitHead) {
        Write-Step "Building canonical backend image from $CanonicalBackendRoot at $GitHead."
        [void](Invoke-Docker -Arguments @(
            "build",
            "--label", "org.opencontainers.image.revision=$GitHead",
            "--label", "com.marjon.runtime.database=$DatabaseName",
            "-t", $imageName,
            $BackendContext
        ))
    }
    return $imageName
}

function New-CanonicalBackendContainer {
    param([string]$GitHead, [string]$ImageName)
    Write-Step "Creating canonical backend runtime $BackendContainer (no DB volume attached)."
    [void](Invoke-Docker -Arguments @(
        "run", "-d",
        "--name", $BackendContainer,
        "--label", "com.marjon.runtime.role=canonical-backend",
        "--label", "com.marjon.runtime.source-worktree=$CanonicalBackendRoot",
        "--label", "org.opencontainers.image.revision=$GitHead",
        "--label", "com.marjon.runtime.database=$DatabaseName",
        "--network", $NetworkName,
        "--network-alias", "backend",
        "-p", "8000:8000",
        "--env-file", $LocalEnvFile,
        "--restart", "unless-stopped",
        $ImageName,
        "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--lifespan", "off"
    ))
}

function Start-CanonicalBackend {
    param([string]$GitHead, [hashtable]$EnvValues)
    Assert-BackendPortAvailable
    $container = Get-ContainerInspect -Name $BackendContainer
    if ($container) {
        Assert-BackendContainerConfig -Container $container -GitHead $GitHead -EnvValues $EnvValues
        if (-not $container.State.Running) {
            Write-Step "Starting existing canonical backend container $BackendContainer."
            [void](Invoke-Docker -Arguments @("start", $BackendContainer))
        }
        return
    }

    $imageName = Ensure-CanonicalImage -GitHead $GitHead
    New-CanonicalBackendContainer -GitHead $GitHead -ImageName $imageName
}

function Wait-ForHttp {
    param([string]$Url, [int]$Seconds = 30)
    for ($attempt = 1; $attempt -le $Seconds; $attempt++) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -Method Get -TimeoutSec 3
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) { return }
        } catch {
            # Service may still be starting.
        }
        Start-Sleep -Seconds 1
    }
    Stop-WithDiagnostic "$Url did not become ready within $Seconds seconds."
}

function Get-ManagedFrontendPid {
    if (-not (Test-Path -LiteralPath $FrontendPidFile -PathType Leaf)) { return $null }
    $raw = (Get-Content -LiteralPath $FrontendPidFile -Raw).Trim()
    $pidValue = 0
    if (-not [int]::TryParse($raw, [ref]$pidValue)) { return $null }
    return $pidValue
}

function Test-OwnedFrontendProcess {
    param([int]$ProcessId)
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
    if (-not $process -or -not $process.CommandLine) { return $false }
    $command = $process.CommandLine.ToLowerInvariant()
    return (
        $command.Contains($FrontendRoot.ToLowerInvariant()) -and
        $command.Contains("vite") -and
        $command.Contains("--host localhost") -and
        $command.Contains("--port 5173")
    )
}

function Get-ManagedHqPid {
    if (-not (Test-Path -LiteralPath $HqPidFile -PathType Leaf)) { return $null }
    $raw = (Get-Content -LiteralPath $HqPidFile -Raw).Trim()
    $pidValue = 0
    if (-not [int]::TryParse($raw, [ref]$pidValue)) { return $null }
    return $pidValue
}

function Test-OwnedHqProcess {
    param([int]$ProcessId)
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
    if (-not $process -or -not $process.CommandLine) { return $false }
    $command = $process.CommandLine.ToLowerInvariant()
    return (
        $command.Contains($HqFrontendRoot.ToLowerInvariant()) -and
        $command.Contains("vite") -and
        $command.Contains("--host localhost") -and
        $command.Contains("--port 5174")
    )
}

function Start-CanonicalFrontend {
    $managedPid = Get-ManagedFrontendPid
    if ($managedPid -and (Test-OwnedFrontendProcess -ProcessId $managedPid)) {
        $listeners = @(Get-HostPortListeners -Port $FrontendPort)
        if (@($listeners.OwningProcess) -contains $managedPid) {
            Write-Step "Canonical frontend is already running as PID $managedPid."
            return
        }
    }

    if (Test-Path -LiteralPath $FrontendPidFile) {
        Remove-Item -LiteralPath $FrontendPidFile -Force
    }
    $listeners = @(Get-HostPortListeners -Port $FrontendPort)
    if ($listeners.Count -gt 0) {
        $pids = @($listeners.OwningProcess | Sort-Object -Unique)
        Stop-WithDiagnostic "Port $FrontendPort is occupied by an unmanaged process (PID: $($pids -join ', ')). Nothing was stopped."
    }

    $node = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $node) { Stop-WithDiagnostic "node.exe is not available." }
    $viteScript = Join-Path $FrontendRoot "node_modules\vite\bin\vite.js"
    if (-not (Test-Path -LiteralPath $viteScript -PathType Leaf)) {
        Stop-WithDiagnostic "Vite is not installed at $viteScript. Run npm install explicitly first."
    }

    [void](New-Item -ItemType Directory -Path $StateRoot -Force)
    Write-Step "Starting Vite at $FrontendUrl from $FrontendRoot."
    $startProcessArguments = @{
        FilePath = $node.Source
        ArgumentList = @($viteScript, "--host", "localhost", "--port", "5173", "--strictPort")
        WorkingDirectory = $FrontendRoot
        WindowStyle = "Hidden"
        RedirectStandardOutput = $FrontendStdout
        RedirectStandardError = $FrontendStderr
        PassThru = $true
    }
    $process = Start-Process @startProcessArguments
    Set-Content -LiteralPath $FrontendPidFile -Value $process.Id -Encoding ascii
    try {
        Wait-ForHttp -Url $FrontendUrl -Seconds 30
    } catch {
        if (Test-OwnedFrontendProcess -ProcessId $process.Id) {
            Stop-Process -Id $process.Id -Force
        }
        throw
    }
}

function Start-HqFrontend {
    $managedPid = Get-ManagedHqPid
    if ($managedPid -and (Test-OwnedHqProcess -ProcessId $managedPid)) {
        $listeners = @(Get-HostPortListeners -Port $HqPort)
        if (@($listeners.OwningProcess) -contains $managedPid) {
            Write-Step "HQ frontend is already running as PID $managedPid."
            return
        }
    }

    if (Test-Path -LiteralPath $HqPidFile) {
        Remove-Item -LiteralPath $HqPidFile -Force
    }
    $listeners = @(Get-HostPortListeners -Port $HqPort)
    if ($listeners.Count -gt 0) {
        $pids = @($listeners.OwningProcess | Sort-Object -Unique)
        Stop-WithDiagnostic "Port $HqPort is occupied by an unmanaged process (PID: $($pids -join ', ')). Nothing was stopped."
    }

    $node = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $node) { Stop-WithDiagnostic "node.exe is not available." }
    $viteScript = Join-Path $HqFrontendRoot "node_modules\vite\bin\vite.js"
    if (-not (Test-Path -LiteralPath $viteScript -PathType Leaf)) {
        Stop-WithDiagnostic "Vite is not installed at $viteScript. Run npm install explicitly first."
    }

    [void](New-Item -ItemType Directory -Path $StateRoot -Force)
    Write-Step "Starting HQ Vite at $HqUrl from $HqFrontendRoot."
    $startProcessArguments = @{
        FilePath = $node.Source
        ArgumentList = @($viteScript, "--host", "localhost", "--port", "5174", "--strictPort")
        WorkingDirectory = $HqFrontendRoot
        WindowStyle = "Hidden"
        RedirectStandardOutput = $HqStdout
        RedirectStandardError = $HqStderr
        PassThru = $true
    }
    $process = Start-Process @startProcessArguments
    Set-Content -LiteralPath $HqPidFile -Value $process.Id -Encoding ascii
    try {
        Wait-ForHttp -Url $HqUrl -Seconds 30
    } catch {
        if (Test-OwnedHqProcess -ProcessId $process.Id) {
            Stop-Process -Id $process.Id -Force
        }
        throw
    }
}

function Stop-CanonicalFrontend {
    $managedPid = Get-ManagedFrontendPid
    if (-not $managedPid) {
        $listeners = @(Get-HostPortListeners -Port $FrontendPort)
        if ($listeners.Count -gt 0) {
            $pids = @($listeners.OwningProcess | Sort-Object -Unique)
            Stop-WithDiagnostic "Cannot stop unmanaged port $FrontendPort listener (PID: $($pids -join ', '))."
        }
        Write-Step "Canonical frontend is already stopped."
        return
    }

    $process = Get-Process -Id $managedPid -ErrorAction SilentlyContinue
    if ($process) {
        if (-not (Test-OwnedFrontendProcess -ProcessId $managedPid)) {
            Stop-WithDiagnostic "PID file points to a process not owned by this Marjon runtime. Nothing was stopped."
        }
        Write-Step "Stopping managed Vite process PID $managedPid."
        Stop-Process -Id $managedPid -Force
        for ($attempt = 1; $attempt -le 15; $attempt++) {
            if (-not (Get-Process -Id $managedPid -ErrorAction SilentlyContinue)) { break }
            Start-Sleep -Milliseconds 250
        }
    }
    if (Test-Path -LiteralPath $FrontendPidFile) {
        Remove-Item -LiteralPath $FrontendPidFile -Force
    }
}

function Stop-HqFrontend {
    $managedPid = Get-ManagedHqPid
    if (-not $managedPid) {
        $listeners = @(Get-HostPortListeners -Port $HqPort)
        if ($listeners.Count -gt 0) {
            $pids = @($listeners.OwningProcess | Sort-Object -Unique)
            Stop-WithDiagnostic "Cannot stop unmanaged port $HqPort listener (PID: $($pids -join ', '))."
        }
        Write-Step "HQ frontend is already stopped."
        return
    }

    $process = Get-Process -Id $managedPid -ErrorAction SilentlyContinue
    if ($process) {
        if (-not (Test-OwnedHqProcess -ProcessId $managedPid)) {
            Stop-WithDiagnostic "HQ PID file points to a process not owned by this Marjon runtime. Nothing was stopped."
        }
        Write-Step "Stopping managed HQ Vite process PID $managedPid."
        Stop-Process -Id $managedPid -Force
        for ($attempt = 1; $attempt -le 15; $attempt++) {
            if (-not (Get-Process -Id $managedPid -ErrorAction SilentlyContinue)) { break }
            Start-Sleep -Milliseconds 250
        }
    }
    if (Test-Path -LiteralPath $HqPidFile) {
        Remove-Item -LiteralPath $HqPidFile -Force
    }
}

function Stop-CanonicalBackend {
    $container = Get-ContainerInspect -Name $BackendContainer
    if (-not $container) {
        Write-Step "Canonical backend container is already absent."
        return
    }
    $role = Get-ObjectPropertyValue -Object $container.Config.Labels -Name "com.marjon.runtime.role"
    if ($role -ne "canonical-backend") {
        Stop-WithDiagnostic "$BackendContainer lacks the canonical runtime label. Nothing was stopped."
    }
    if ($container.State.Running) {
        Write-Step "Stopping managed backend container $BackendContainer."
        [void](Invoke-Docker -Arguments @("stop", $BackendContainer))
    } else {
        Write-Step "Canonical backend is already stopped."
    }
}

function Verify-BackendRuntime {
    param([string]$GitHead, [hashtable]$EnvValues)
    Assert-CanonicalDatabaseContainer
    Assert-DatabaseAndMigration
    Assert-CanonicalRbacState
    Assert-WrongBackendStopped

    $owners = @(Get-DockerPortOwners -Port $BackendPort)
    if ($owners.Count -ne 1 -or $owners[0] -ne $BackendContainer) {
        Stop-WithDiagnostic "Port $BackendPort owner must be exactly $BackendContainer; got '$($owners -join ',')'."
    }
    $container = Get-ContainerInspect -Name $BackendContainer
    if (-not $container -or -not $container.State.Running) {
        Stop-WithDiagnostic "$BackendContainer is not running."
    }
    Assert-BackendContainerConfig -Container $container -GitHead $GitHead -EnvValues $EnvValues

    Wait-ForHttp -Url "$BackendUrl/health" -Seconds 15
    $openApi = Invoke-RestMethod -Uri "$BackendUrl/openapi.json" -Method Get -TimeoutSec 10
    if ($openApi.paths.PSObject.Properties.Name -notcontains "/api/v1/auth/admin/login") {
        Stop-WithDiagnostic "Canonical OpenAPI route /api/v1/auth/admin/login is missing."
    }

    Write-Step "VERIFIED :8000=$BackendContainer; DB=$DatabaseContainer/$DatabaseName; network=$NetworkName."
}

function Verify-Runtime {
    param([string]$GitHead, [hashtable]$EnvValues)
    Verify-BackendRuntime -GitHead $GitHead -EnvValues $EnvValues

    $frontendPid = Get-ManagedFrontendPid
    if (-not $frontendPid -or -not (Test-OwnedFrontendProcess -ProcessId $frontendPid)) {
        Stop-WithDiagnostic "Managed localhost frontend process is not running."
    }
    $frontendListeners = @(Get-HostPortListeners -Port $FrontendPort)
    if (@($frontendListeners.OwningProcess) -notcontains $frontendPid) {
        Stop-WithDiagnostic "Port $FrontendPort is not owned by managed Vite PID $frontendPid."
    }

    $hqPid = Get-ManagedHqPid
    if (-not $hqPid -or -not (Test-OwnedHqProcess -ProcessId $hqPid)) {
        Stop-WithDiagnostic "Managed HQ frontend process is not running."
    }
    $hqListeners = @(Get-HostPortListeners -Port $HqPort)
    if (@($hqListeners.OwningProcess) -notcontains $hqPid) {
        Stop-WithDiagnostic "Port $HqPort is not owned by managed HQ Vite PID $hqPid."
    }

    Wait-ForHttp -Url $FrontendUrl -Seconds 15
    Wait-ForHttp -Url $HqUrl -Seconds 15

    Write-Step "VERIFIED frontend=$FrontendUrl; HQ=$HqUrl; backend=$BackendUrl."
}

function Start-DevRuntime {
    Assert-Tooling
    $envValues = Read-LocalEnv
    Assert-LocalEnv -Values $envValues
    $gitHead = Get-CanonicalGitHead
    Write-Step "Canonical backend HEAD: $gitHead"
    Assert-CanonicalDatabaseContainer -StartIfStopped
    Assert-DatabaseAndMigration
    Assert-CanonicalRbacState
    Assert-WrongBackendStopped
    Start-CanonicalBackend -GitHead $gitHead -EnvValues $envValues
    Wait-ForHttp -Url "$BackendUrl/health" -Seconds 30
    Start-CanonicalFrontend
    Start-HqFrontend
    Verify-Runtime -GitHead $gitHead -EnvValues $envValues
}

function Stop-DevRuntime {
    Assert-Tooling
    Stop-HqFrontend
    Stop-CanonicalFrontend
    Stop-CanonicalBackend
    Write-Step "Runtime stopped. Canonical DB and all volumes were left running/untouched."
}

function Refresh-CanonicalBackend {
    Assert-Tooling
    $envValues = Read-LocalEnv
    Assert-LocalEnv -Values $envValues
    $gitHead = Get-CanonicalGitHead
    Write-Step "Explicit backend refresh requested for canonical HEAD: $gitHead"

    # RefreshBackend never starts, recreates, or otherwise changes a database.
    Assert-CanonicalDatabaseContainer
    Assert-DatabaseAndMigration
    Assert-CanonicalRbacState
    Assert-WrongBackendStopped
    Assert-BackendPortAvailable

    $container = Get-ContainerInspect -Name $BackendContainer
    if ($container) {
        Assert-ManagedBackendContainerOwnership -Container $container
    }

    # Build first so a failed build cannot take down the current managed runtime.
    $imageName = Ensure-CanonicalImage -GitHead $gitHead -ForceBuild

    if ($container) {
        if ($container.State.Running) {
            Write-Step "Stopping only managed stateless backend $BackendContainer."
            [void](Invoke-Docker -Arguments @("stop", $BackendContainer))
        }
        Write-Step "Removing only managed stateless backend container $BackendContainer (no mounts/volumes)."
        [void](Invoke-Docker -Arguments @("rm", $BackendContainer))
    }

    New-CanonicalBackendContainer -GitHead $gitHead -ImageName $imageName
    Wait-ForHttp -Url "$BackendUrl/health" -Seconds 30
    Verify-BackendRuntime -GitHead $gitHead -EnvValues $envValues
    Write-Step "RefreshBackend complete. Canonical DB, all volumes, and frontend runtime were untouched."
}

try {
    switch ($Action) {
        "Start" {
            Start-DevRuntime
        }
        "Stop" {
            Stop-DevRuntime
        }
        "Restart" {
            Stop-DevRuntime
            Start-DevRuntime
        }
        "Verify" {
            Assert-Tooling
            $envValues = Read-LocalEnv
            Assert-LocalEnv -Values $envValues
            $gitHead = Get-CanonicalGitHead
            Verify-Runtime -GitHead $gitHead -EnvValues $envValues
        }
        "RefreshBackend" {
            Refresh-CanonicalBackend
        }
    }
} catch {
    Write-Error $_.Exception.Message
    exit 1
}
