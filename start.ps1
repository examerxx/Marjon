#Requires -Version 5.1
<#
  Marjon - dev-лаунчер (Windows).

  Запускает связки:
    1) Frontend (web+admin) + Backend
    2) Desktop (Electron)   + Backend
    3) Mobile  (Flutter)    + Backend
    4) Owner   (Flutter)    + Backend
    5) Всё вместе
    6) Только Backend

  Backend и Frontend поднимаются через Docker Compose (docker-compose.yml, сервисы
  db/redis/minio/backend/frontend) — контейнеры работают в фоне (-d), логи смотрите
  через `docker compose logs -f backend` / `frontend`, остановка — `docker compose down`.
  Desktop (Electron) и Mobile/Owner (Flutter) — GUI-приложения, их по-прежнему запускаем
  нативно, каждое в своём окне PowerShell.

  Требуется установленный и запущенный Docker Desktop.

  Запуск: двойной клик по start.cmd  (или:  powershell -ExecutionPolicy Bypass -File .\start.ps1)
  Непереключаемый режим:  .\start.ps1 -Mode front | desktop | mobile | owner | all | backend
#>

[CmdletBinding()]
param(
    [ValidateSet('front', 'desktop', 'mobile', 'owner', 'all', 'backend', '')]
    [string]$Mode = ''
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$Root         = $PSScriptRoot
$BackendDir   = Join-Path $Root 'backend'
$FrontendDir  = Join-Path $Root 'frontend'
$DesktopDir   = Join-Path $Root 'desktop'
$MobileDir    = Join-Path $Root 'mobile'
$OwnerDir     = Join-Path $Root 'owner'

$BackendPort  = 8000
$FrontendPort = 5173

# ── Вывод ─────────────────────────────────────────────────────────────────────
function Write-Head { param([string]$Text) Write-Host ''; Write-Host "== $Text" -ForegroundColor Cyan }
function Write-Ok   { param([string]$Text) Write-Host "  [OK]   $Text" -ForegroundColor Green }
function Write-Info { param([string]$Text) Write-Host "  ->     $Text" -ForegroundColor Gray }
function Write-Warn2{ param([string]$Text) Write-Host "  [!]    $Text" -ForegroundColor Yellow }
function Write-Err2 { param([string]$Text) Write-Host "  [ERR]  $Text" -ForegroundColor Red }

# ── Утилиты ───────────────────────────────────────────────────────────────────
function Test-Cmd {
    param([string]$Name)
    $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Test-Port {
    param([string]$HostName = '127.0.0.1', [int]$Port, [int]$TimeoutMs = 700)
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $ar = $client.BeginConnect($HostName, $Port, $null, $null)
        if (-not $ar.AsyncWaitHandle.WaitOne($TimeoutMs, $false)) { return $false }
        $client.EndConnect($ar)
        return $true
    } catch {
        return $false
    } finally {
        $client.Close()
    }
}

function Get-LanIp {
    # Берём адрес интерфейса, через который идёт маршрут ПО УМОЛЧАНИЮ — это реальная
    # сеть (Wi-Fi/Ethernet). Иначе выбирался виртуальный адаптер VirtualBox/Hyper-V/WSL
    # (192.168.56.x, 172.17.x и подобные), и с телефона адрес был недоступен.
    $ip = $null
    try {
        $route = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction Stop |
                 Where-Object { $_.NextHop -ne '0.0.0.0' } |
                 Sort-Object -Property RouteMetric, ifMetric |
                 Select-Object -First 1
        if ($route) {
            $ip = (Get-NetIPAddress -InterfaceIndex $route.ifIndex -AddressFamily IPv4 -ErrorAction Stop |
                   Where-Object { $_.IPAddress -ne '127.0.0.1' } |
                   Select-Object -First 1).IPAddress
        }
    } catch { $ip = $null }

    # Фолбэк: любой приватный адрес, кроме известных виртуальных диапазонов и адаптеров
    if (-not $ip) {
        try {
            $virtualNames = '*VirtualBox*', '*Hyper-V*', '*VMware*', '*WSL*', '*Loopback*', '*vEthernet*'
            $cands = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
                     Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.IPAddress -notlike '192.168.56.*' -and $_.IPAddress -notlike '169.254.*' }
            foreach ($c in $cands) {
                $alias = $c.InterfaceAlias
                $isVirtual = $false
                foreach ($n in $virtualNames) { if ($alias -like $n) { $isVirtual = $true } }
                if (-not $isVirtual) { $ip = $c.IPAddress; break }
            }
            if (-not $ip -and $cands) { $ip = ($cands | Select-Object -First 1).IPAddress }
        } catch { $ip = $null }
    }

    if (-not $ip) { $ip = '127.0.0.1' }
    return $ip
}

function Start-Win {
    param([string]$Title, [string]$WorkDir, [string]$Command)
    $inner = '$Host.UI.RawUI.WindowTitle = ''' + $Title + '''; ' +
             'Set-Location -LiteralPath ''' + $WorkDir + '''; ' +
             $Command
    Start-Process -FilePath 'powershell.exe' `
                  -ArgumentList @('-NoExit', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $inner) | Out-Null
    Write-Ok "окно запущено: $Title"
}

function Confirm-Yes {
    param([string]$Question, [switch]$DefaultYes)
    if ($DefaultYes) { $suffix = '[Y/n]' } else { $suffix = '[y/N]' }
    $answer = Read-Host "  $Question $suffix"
    if ([string]::IsNullOrWhiteSpace($answer)) { return [bool]$DefaultYes }
    return ($answer -match '^(y|yes|д|да)$')
}

# ── Docker (backend + frontend) ──────────────────────────────────────────────
function Test-DockerReady {
    if (-not (Test-Cmd 'docker')) {
        Write-Err2 'docker не найден в PATH. Установите Docker Desktop: https://www.docker.com/products/docker-desktop/'
        return $false
    }
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & docker info *> $null
        if ($LASTEXITCODE -ne 0) {
            Write-Err2 'Docker Desktop не отвечает. Запустите его и повторите попытку.'
            return $false
        }
        return $true
    } finally {
        $ErrorActionPreference = $prevEap
    }
}

function Invoke-DockerComposeUp {
    param([string[]]$Services)
    if (-not (Test-DockerReady)) { return $false }
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    Push-Location $Root
    try {
        Write-Info ("docker compose up -d --build " + ($Services -join ' '))
        & docker compose up -d --build @Services
        if ($LASTEXITCODE -ne 0) {
            Write-Err2 "docker compose завершился с ошибкой (код $LASTEXITCODE) — см. вывод выше"
            return $false
        }
        return $true
    } finally {
        Pop-Location
        $ErrorActionPreference = $prevEap
    }
}

function Start-Backend {
    param([string]$LanIp = '127.0.0.1')
    Write-Head 'Backend (Docker: FastAPI + Postgres + Redis + MinIO)'

    if (Test-Port -Port $BackendPort) {
        Write-Ok "порт $BackendPort уже занят — считаю, что бэкенд запущен, второй раз не поднимаю"
        return $true
    }

    # Разрешённые origin. ВАЖНО: если задать ALLOWED_ORIGINS через env — она полностью
    # ЗАМЕНЯЕТ дефолтный список в config.py (там 5173-5177 для localhost/127.0.0.1,
    # специально под несколько параллельных Vite dev-серверов: веб-фронт занимает
    # 5173, а desktop (electron-vite) при занятом 5173 сам поднимается на следующем
    # свободном порту — 5174, 5175...). Раньше здесь передавался только $FrontendPort,
    # из-за чего desktop получал CORS-отказ (400 на OPTIONS /auth/login) и не мог
    # логиниться, хотя веб-панель на 5173 работала нормально. Поэтому здесь нужно
    # передавать весь тот же диапазон портов, только добавляя ещё и LAN-IP — для теста
    # с планшета/телефона.
    $devPorts = 5173..5177
    $localOrigins = $devPorts | ForEach-Object { "http://localhost:$_", "http://127.0.0.1:$_" }
    $lanOrigins = $devPorts | ForEach-Object { "http://$($LanIp):$_" }
    $origins = ($localOrigins + $lanOrigins) -join ','
    Write-Info "CORS разрешён для: $origins"
    $env:ALLOWED_ORIGINS = $origins

    if (-not (Invoke-DockerComposeUp -Services @('db', 'redis', 'minio', 'minio-init', 'backend'))) {
        return $false
    }

    Write-Info 'ждём порт 8000 (первый запуск дольше — идёт сборка образа и миграции)...'
    for ($i = 0; $i -lt 90; $i++) {
        if (Test-Port -Port $BackendPort) { break }
        Start-Sleep -Milliseconds 500
    }
    if (Test-Port -Port $BackendPort) {
        Write-Ok "бэкенд отвечает: http://localhost:$BackendPort/docs"
        return $true
    }
    Write-Warn2 'бэкенд пока не ответил — смотрите логи: docker compose logs -f backend'
    return $false
}

# ── Доступ по локальной сети (тест с планшетов/телефонов) ─────────────────────
function Test-IsAdmin {
    try {
        $id = [Security.Principal.WindowsIdentity]::GetCurrent()
        return (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole(
            [Security.Principal.WindowsBuiltInRole]::Administrator)
    } catch { return $false }
}

function Initialize-Firewall {
    # Windows по умолчанию блокирует входящие подключения к 8000/5173,
    # поэтому телефон/планшет не увидит ни API, ни веб-интерфейс.
    $rules = @(
        @{ Name = 'Marjon Backend 8000';  Port = $BackendPort },
        @{ Name = 'Marjon Frontend 5173'; Port = $FrontendPort }
    )
    $missing = @()
    foreach ($r in $rules) {
        $exists = $null
        try { $exists = Get-NetFirewallRule -DisplayName $r.Name -ErrorAction SilentlyContinue } catch { }
        if ($exists) { Write-Ok ("фаервол: правило есть — {0}" -f $r.Name) } else { $missing += $r }
    }
    if ($missing.Count -eq 0) { return }

    if (Test-IsAdmin) {
        if (Confirm-Yes 'Открыть порты 8000/5173 в фаерволе для локальной сети?' -DefaultYes) {
            foreach ($r in $missing) {
                try {
                    New-NetFirewallRule -DisplayName $r.Name -Direction Inbound -Action Allow `
                        -Protocol TCP -LocalPort $r.Port -Profile Private | Out-Null
                    Write-Ok ("фаервол: правило добавлено — {0} (порт {1}, профиль Private)" -f $r.Name, $r.Port)
                } catch {
                    Write-Err2 ("не удалось добавить правило {0}: {1}" -f $r.Name, $_.Exception.Message)
                }
            }
        }
    } else {
        Write-Warn2 'Портов в фаерволе нет, а прав администратора нет — с других устройств не подключиться.'
        Write-Warn2 'Запустите PowerShell от имени администратора и выполните:'
        foreach ($r in $missing) {
            Write-Host ("         New-NetFirewallRule -DisplayName '{0}' -Direction Inbound -Action Allow -Protocol TCP -LocalPort {1} -Profile Private" -f $r.Name, $r.Port) -ForegroundColor DarkGray
        }
    }
}

function Set-FrontendLanEnv {
    param([string]$LanIp)
    # Веб и админка по умолчанию обращаются к http://127.0.0.1:8000 — с планшета это
    # будет сам планшет. Поэтому фиксируем реальный IP этого компьютера в .env.local
    # (файл в .gitignore, на репозиторий не влияет).
    $file = Join-Path $FrontendDir '.env.local'
    $api  = "http://$($LanIp):$BackendPort/api/v1"
    $body = @(
        '# Сгенерировано лаунчером start.ps1 для теста в локальной сети.',
        '# Адрес API должен быть виден с других устройств, поэтому не 127.0.0.1.',
        "VITE_API_URL=$api",
        "VITE_ADMIN_API_URL=$api"
    ) -join "`r`n"

    $old = ''
    if (Test-Path -LiteralPath $file) { $old = (Get-Content -LiteralPath $file -Raw -ErrorAction SilentlyContinue) }
    if ($old.Trim() -eq $body.Trim()) {
        Write-Ok "адрес API для веба уже настроен: $api"
        return
    }
    try {
        Set-Content -LiteralPath $file -Value $body -Encoding UTF8
        Write-Ok "адрес API для веба записан в frontend\.env.local: $api"
    } catch {
        Write-Err2 ("не удалось записать .env.local: {0}" -f $_.Exception.Message)
    }
}

# ── Клиенты ───────────────────────────────────────────────────────────────────
function Get-NpmBootstrap {
    # Одной строкой (без переводов строк — команда уходит в Start-Process как один аргумент):
    #  - нет node_modules            -> npm install
    #  - есть, но состав неполный    -> npm install  (случай отсутствующего 'ws' после обновления package.json)
    return '$need = -not (Test-Path node_modules); ' +
           'if (-not $need) { npm ls --depth=0 --silent 2>$null | Out-Null; $need = ($LASTEXITCODE -ne 0) }; ' +
           'if ($need) { Write-Host "Ставлю зависимости (npm install)..." -ForegroundColor Yellow; npm install }; '
}

function Start-Frontend {
    param([string]$LanIp = '127.0.0.1')
    Write-Head 'Frontend (Docker: Vite dev-сервер)'
    if (Test-Port -Port $FrontendPort) {
        Write-Warn2 "порт $FrontendPort занят — возможно, dev-сервер уже запущен"
        return
    }
    Set-FrontendLanEnv -LanIp $LanIp

    if (-not (Invoke-DockerComposeUp -Services @('frontend'))) { return }

    Write-Info "веб:    http://localhost:$FrontendPort/"
    Write-Info "админка: http://localhost:$FrontendPort/admin.html"
    Write-Info ("с других устройств: http://{0}:{1}/" -f $LanIp, $FrontendPort)
}

function Start-Desktop {
    Write-Head 'Desktop (Electron)'
    if (-not (Test-Cmd 'npm')) { Write-Err2 'npm не найден в PATH (нужен Node.js)'; return }

    $cmd = (Get-NpmBootstrap) + 'npm run dev'
    Start-Win -Title 'Marjon Desktop' -WorkDir $DesktopDir -Command $cmd
    Write-Info 'адрес сервера в десктопе: http://127.0.0.1:8000/api/v1'
}

function Start-FlutterApp {
    param([string]$Title, [string]$Dir, [string]$LanIp)
    Write-Head $Title
    if (-not (Test-Cmd 'flutter')) { Write-Err2 'flutter не найден в PATH — установите Flutter SDK'; return }
    if (-not (Test-Path -LiteralPath $Dir)) { Write-Err2 "нет папки: $Dir"; return }

    $cmd = 'flutter pub get; flutter run'
    Start-Win -Title $Title -WorkDir $Dir -Command $cmd
    Write-Info 'если устройств несколько — flutter спросит, какое выбрать, в своём окне'
    Write-Info ('адрес сервера в приложении: http://' + $LanIp + ':' + $BackendPort + '/api/v1')
}

# ── Итоговая сводка ───────────────────────────────────────────────────────────
function Show-Summary {
    param([string]$LanIp)
    Write-Host ''
    Write-Host '──────────────────────────────────────────────' -ForegroundColor DarkGray
    Write-Host ' Адреса' -ForegroundColor Cyan
    Write-Host ("  API / Swagger : http://localhost:{0}/docs" -f $BackendPort)
    Write-Host ("  Веб           : http://localhost:{0}/" -f $FrontendPort)
    Write-Host ("  Админка       : http://localhost:{0}/admin.html" -f $FrontendPort)
    Write-Host ("  Для телефона  : http://{0}:{1}/api/v1" -f $LanIp, $BackendPort)
    Write-Host '──────────────────────────────────────────────' -ForegroundColor DarkGray
    Write-Host ' Backend/Frontend работают в Docker (в фоне). Логи: docker compose logs -f backend|frontend' -ForegroundColor DarkGray
    Write-Host ' Остановить их: docker compose down. Desktop/Mobile/Owner — закрыть их окно. Телефон должен быть в той же Wi-Fi сети.' -ForegroundColor DarkGray
    Write-Host ''
}

# ── Режимы ────────────────────────────────────────────────────────────────────
function Invoke-Mode {
    param([string]$Selected)
    $lanIp = Get-LanIp

    Write-Head 'Локальная сеть'
    Write-Info "IP этого компьютера: $lanIp"
    if ($lanIp -like '192.168.56.*' -or $lanIp -like '169.254.*' -or $lanIp -eq '127.0.0.1') {
        Write-Warn2 'Похоже, это виртуальный адаптер (VirtualBox/Hyper-V), а не Wi-Fi.'
        Write-Warn2 'С телефона такой адрес недоступен. Реальный адрес смотрите так:'
        Write-Host  '         ipconfig | Select-String -Pattern "IPv4"' -ForegroundColor DarkGray
    }
    Initialize-Firewall

    switch ($Selected) {
        'backend' { Start-Backend -LanIp $lanIp | Out-Null }
        'front'   { Start-Backend -LanIp $lanIp | Out-Null; Start-Frontend -LanIp $lanIp }
        'desktop' { Start-Backend -LanIp $lanIp | Out-Null; Start-Desktop }
        'mobile'  { Start-Backend -LanIp $lanIp | Out-Null; Start-FlutterApp -Title 'Marjon Mobile (Flutter)' -Dir $MobileDir -LanIp $lanIp }
        'owner'   { Start-Backend -LanIp $lanIp | Out-Null; Start-FlutterApp -Title 'Marjon Owner (Flutter)'  -Dir $OwnerDir  -LanIp $lanIp }
        'all'     {
            Start-Backend -LanIp $lanIp | Out-Null
            Start-Frontend -LanIp $lanIp
            Start-Desktop
            Start-FlutterApp -Title 'Marjon Mobile (Flutter)' -Dir $MobileDir -LanIp $lanIp
            Start-FlutterApp -Title 'Marjon Owner (Flutter)'  -Dir $OwnerDir  -LanIp $lanIp
        }
        default   { return }
    }

    Show-Summary -LanIp $lanIp
}

function Show-Menu {
    Write-Host ''
    Write-Host '=============================================' -ForegroundColor Cyan
    Write-Host '            MARJON - запуск проекта          ' -ForegroundColor Cyan
    Write-Host '=============================================' -ForegroundColor Cyan
    Write-Host '  1) Frontend (веб + админка)  + Backend'
    Write-Host '  2) Desktop (касса/кухня)     + Backend'
    Write-Host '  3) Mobile (Flutter)          + Backend'
    Write-Host '  4) Owner (Flutter)           + Backend'
    Write-Host '  5) Всё вместе'
    Write-Host '  6) Только Backend'
    Write-Host '  0) Выход'
    Write-Host ''
}

# ── Точка входа ───────────────────────────────────────────────────────────────
if ($Mode -ne '') {
    Invoke-Mode -Selected $Mode
    exit 0
}

while ($true) {
    Show-Menu
    $choice = Read-Host 'Выберите пункт'
    switch ($choice) {
        '1' { Invoke-Mode -Selected 'front';   break }
        '2' { Invoke-Mode -Selected 'desktop'; break }
        '3' { Invoke-Mode -Selected 'mobile';  break }
        '4' { Invoke-Mode -Selected 'owner';   break }
        '5' { Invoke-Mode -Selected 'all';     break }
        '6' { Invoke-Mode -Selected 'backend'; break }
        '0' { Write-Host 'Выход.'; exit 0 }
        default { Write-Warn2 'Нет такого пункта. Введите 0-6.'; continue }
    }
    Write-Host ''
    if (-not (Confirm-Yes 'Запустить ещё связку?')) { break }
}

Write-Host 'Готово. Backend/Frontend — в Docker, остальное — в своих окнах.' -ForegroundColor Green
