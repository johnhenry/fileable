//https://stackoverflow.com/questions/2817646/javascript-split-string-on-space-or-on-quotes-to-array
import yargs from 'yargs';
import * as build from './commands/build.js';
yargs
    .command(build)
    .demandCommand()
    .help()
    .argv;
