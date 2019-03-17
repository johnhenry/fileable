#!/usr/bin/env node
import { readFileSync } from 'fs';
import yargs from 'yargs';
import findUp from 'find-up';
const configPath = findUp.sync(['.myapprc', '.myapprc.json'])
const config = configPath ? JSON.parse(readFileSync(configPath)) : {}

import * as build from './commands/build.js';
yargs
    .config(config)
    .command(build)
    .demandCommand()
    .help()
    .argv;
