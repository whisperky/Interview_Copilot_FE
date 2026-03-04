# Native WASAPI Loopback Addon

Builds `loopback.node` for Electron.

## Prerequisites (Windows)

- Visual Studio Build Tools (Desktop development with C++)
- Windows SDK
- Python 3

## Install

```bash
cd frontend/native-addon
npm install
```

## Build for Electron 30.5.1

PowerShell:

```powershell
$env:npm_config_runtime="electron"
$env:npm_config_target="30.5.1"
$env:npm_config_disturl="https://electronjs.org/headers"
$env:npm_config_build_from_source="true"
npm run build
```

Output:

`frontend/native-addon/build/Release/loopback.node`

Copy it to:

`frontend/native/loopback.node`

Then run frontend:

```bash
cd frontend
npm run dev
```

Click `Start Audio` and verify UI shows `audio: native`.
