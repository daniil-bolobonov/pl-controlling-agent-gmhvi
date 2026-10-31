#!/usr/bin/env sh

name="${1:?Usage: project-init.sh <project name>}"

log() { echo ">>> [project-init] $*"; }

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

log "Initializing CAP project: $name"
cds init "$name" --add hana --nodejs
cd "$name"

log "Installing dev dependencies"
npm install --save-dev @sap/cds-dk @cap-js/cds-test c8

log "Adding React frontend via cds add react"
cds add react --into react-ui

log "Adding IAS authentication via cds add ias"
cds add ias

log "Setting package scripts"
npm pkg set scripts.build="npm run build --workspace=app/react-ui && cds build --production"
npm pkg set scripts.test="c8 --reporter=json node --test --test-reporter=spec --test-reporter-destination=stdout --test-reporter=./scripts/test-report-reporter.mjs --test-reporter-destination=stdout 'test/**/*.test.js' && node ./scripts/write-test-report.mjs"

log "Installing test reporter scripts for node:test"
mkdir -p scripts
cp "$script_dir/../templates/test-report-reporter.mjs" scripts/test-report-reporter.mjs
cp "$script_dir/../templates/write-test-report.mjs" scripts/write-test-report.mjs

log "Configuring npm workspace for app/react-ui"
npm pkg set 'workspaces[]=app/react-ui'

log "Configuring profile-specific cds settings in package.json"
npm pkg set --json 'cds={"[development]":{"requires":{"auth":"dummy"}},"[production]":{"folders":{"app":"app/react-ui/dist"}}}'

log "Adding UI5 web component dependencies to app/react-ui"
(
  cd app/react-ui
  npm pkg set 'dependencies.@ui5/webcomponents=latest'
  npm pkg set 'dependencies.@ui5/webcomponents-fiori=latest'
  npm pkg set 'dependencies.@ui5/webcomponents-icons=latest'
  npm pkg set 'dependencies.@ui5/webcomponents-react=latest'
)

log "Running npm install in background"
npm install > /dev/null 2>&1 &
