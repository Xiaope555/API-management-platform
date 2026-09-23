# =====================================================================
#  Build the Android debug APK.
#
#  1) makes sure the web assets are in sync (cap sync android)
#  2) points Gradle at the JDK 21 + Android SDK under ..\.toolchain\
#  3) runs assembleDebug
#
#  NOTE: keep $ErrorActionPreference = 'Continue'. PowerShell 5.1 turns
#  native stderr output (java -version, gradle progress) into a
#  terminating NativeCommandError under 'Stop', which kills the script.
#  We check $LASTEXITCODE explicitly instead.
#
#  Usage:  powershell -ExecutionPolicy Bypass -File build-android.ps1
# =====================================================================

$ErrorActionPreference = 'Continue'

$app = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)   # ...\app
$ws = Split-Path -Parent $app                                                  # workspace root
$tc = Join-Path $ws '.toolchain'

function Log($m) { Write-Output ('> ' + $m) }
function Die($m) { Write-Output ('> FAILED: ' + $m); exit 1 }

# ---------------------------------------------------------- toolchain
$jdk = Join-Path $tc 'jdk21'
$sdk = Join-Path $tc 'android-sdk'

if (-not (Test-Path (Join-Path $jdk 'bin\java.exe'))) {
    Die "JDK 21 not found at $jdk`n  run:  powershell -ExecutionPolicy Bypass -File `"$tc\setup-android.ps1`""
}
if (-not (Test-Path (Join-Path $sdk 'platforms\android-36'))) {
    Die "Android SDK 36 not found at $sdk`n  run:  powershell -ExecutionPolicy Bypass -File `"$tc\setup-android.ps1`""
}

$env:JAVA_HOME = $jdk
$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk
$env:Path = (Join-Path $jdk 'bin') + ';' + $env:Path

Log ("JAVA_HOME    = $jdk")
Log ("ANDROID_HOME = $sdk")
java -version 2>&1 | Select-Object -First 1 | ForEach-Object { Log $_ }

# ------------------------------------------------------------- sync
Push-Location $app
try {
    Log 'syncing web assets into the android project...'
    & npx cap sync android 2>&1 | ForEach-Object { if ($_ -match '^\[|error|Error') { Log $_ } }
    if ($LASTEXITCODE -ne 0) { Die 'cap sync failed' }
} finally {
    Pop-Location
}

# ------------------------------------------------------------ build
# Prefer a gradle we downloaded ourselves. The wrapper insists on fetching
# gradle-8.14.3-all.zip from services.gradle.org with a hard 10s socket
# timeout (networkTimeout in gradle-wrapper.properties), which fails on slow
# links before it can make any progress. Set up by setup-android.ps1.
if (-not (Test-Path (Join-Path $tc 'gradle-8.14.3'))) {
    $gz = Join-Path $tc 'dl\gradle-8.14.3-bin.zip'
    if (-not (Test-Path $gz)) {
        Log 'downloading gradle 8.14.3 (~130MB, the wrapper cannot do this on a slow link)...'
        curl.exe -L --retry 3 --retry-delay 3 -o $gz 'https://services.gradle.org/distributions/gradle-8.14.3-bin.zip'
    }
    if (Test-Path $gz) {
        Log 'extracting gradle...'
        Expand-Archive -Path $gz -DestinationPath $tc -Force
    }
}
$localGradle = Join-Path $tc 'gradle-8.14.3\bin\gradle.bat'

Push-Location (Join-Path $app 'android')
try {
    if (Test-Path $localGradle) {
        Log 'running gradle assembleDebug (local gradle, first run resolves android deps) ...'
        $gradle = $localGradle
    } else {
        Log 'running gradlew assembleDebug ...'
        Log '(first run downloads the gradle distribution + android deps, this can take a while)'
        $gradle = Join-Path (Get-Location) 'gradlew.bat'
    }
    # Stream gradle output straight to a log file. Buffering it in a variable
    # means you see NOTHING for the whole (often multi-minute) build, and you
    # cannot tell "still downloading" from "hung".
    $gradleLog = Join-Path $app '_gradle.log'
    & $gradle assembleDebug --no-daemon --console=plain 2>&1 |
        Tee-Object -FilePath $gradleLog | Out-Null
    $code = $LASTEXITCODE

    Get-Content $gradleLog -ErrorAction SilentlyContinue |
        Where-Object { $_.Trim() -ne '' } |
        Where-Object { $_ -match 'BUILD |FAILURE|error:|Error:|What went wrong|^\s*> |Caused by|Could not|Download ' } |
        Select-Object -Last 30 | ForEach-Object { Log $_ }
    if ($code -ne 0) { Die "gradle build failed (exit $code) - see $gradleLog" }
} finally {
    Pop-Location
}

$apk = Join-Path $app 'android\app\build\outputs\apk\debug\app-debug.apk'
if (Test-Path $apk) {
    $mb = [math]::Round((Get-Item $apk).Length / 1MB, 2)
    Log ''
    Log ("APK ready: $apk  ($mb MB)")
    Log ('install with:  adb install -r "' + $apk + '"')
    Log 'no adb? copy the apk to the phone and open it (allow install from unknown sources).'
} else {
    Die "build reported success but no APK at $apk"
}
