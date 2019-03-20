const tape = require('tape');
const { execSync } = require('child_process');
const { existsSync } = require('fs');
const { join } = require('path');
const { promisify } = require('util');
const rimraf = require('rimraf');
const rmdir = promisify(rimraf);
const destination = './dist/temp/';
tape('cli test: fileable build', async ({ok, end}) => {
    // clear directory
    await rmdir(destination);
    execSync(`npm run fileable -- build ./test/example/template.jsx ${destination} --no-test --input ./test/example/input.human.js `);
    end();
});
