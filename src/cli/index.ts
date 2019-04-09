#!/usr/bin/env node
import { readFileSync } from 'fs';
import yargs from 'yargs';
import findUp from 'find-up';
const configPath = findUp.sync(['.fileable', '.fileable.json']);
const config = configPath ? JSON.parse(readFileSync(configPath)) : {};

import * as build from './commands/build.ts';
import * as dependencies from './commands/dependencies.ts';
import * as install from './commands/install.ts';
import * as uninstall from './commands/uninstall.ts';
import * as template from './commands/template.ts';

yargs
    .config(config)
    .command(build)
    .command(dependencies)
    .command(install)
    .command(uninstall)
    .command(template)
    .demandCommand()
    .recommendCommands()
    .strict()
    .help()
    .alias('help', 'h').argv;
