@echo off
@setlocal enabledelayedexpansion
pushd %~dp0

echo Checking Git installation
git --version > nul 2>&1
if %errorlevel% neq 0 (
    echo [91mGit is not installed on this system.[0m
    echo Install it from https://git-scm.com/downloads
    goto end
)

if not exist .git (
    echo [91mNot running from a Git repository.[0m
    goto end
)

:: Get current branch to return to later
FOR /F "tokens=*" %%i IN ('git rev-parse --abbrev-ref HEAD') DO SET CURRENT_BRANCH=%%i
echo Current branch: %CURRENT_BRANCH%

:: Verify we're not already on staging
if "%CURRENT_BRANCH%"=="staging" (
    echo [91mAlready on staging branch. Switch to your feature branch first.[0m
    goto end
)

:: Update staging branch
echo Updating staging branch...
git checkout staging || goto error
git pull origin staging || goto error

:: Return to original branch and merge staging
echo Returning to %CURRENT_BRANCH% and merging staging updates...
git checkout %CURRENT_BRANCH% || goto error
git merge staging || goto error

echo [92mSuccessfully updated %CURRENT_BRANCH% with staging changes![0m
goto end

:error
echo [91mError occurred during update process.[0m
echo Please resolve any conflicts manually and try again.

:end
pause
popd