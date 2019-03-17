#!/usr/bin/env node
import { readFileSync } from 'fs';
import yargs from 'yargs';
import findUp from 'find-up';
const configPath = findUp.sync(['.fileable', '.fileable.json']);
const config = configPath ? JSON.parse(readFileSync(configPath)) : {};

import * as build from './commands/build.ts';
yargs
    .config(config)
    .command(build)
    .demandCommand()
    .help()
    .argv;
