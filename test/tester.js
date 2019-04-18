const tape = require('tape');
const { promisify } = require('util');
const rimraf = require('rimraf');
const rmdir = promisify(rimraf);
const { validate } = require('testafile');
const tester = (
    name,
    folder_context,
    prep,
    validation,
    validateOptions) =>
    tape(name, async ({ ok, end }) => {
        // clear directory
        await rmdir(folder_context);
        // run program
        await prep();
        // run tests
        ok(...validate(folder_context, validation, validateOptions));
        end();
        //Cleanup
        await rmdir(folder_context);
    });
module.exports = tester;
