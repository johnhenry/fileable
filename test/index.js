const tape = require('tape');
const {iterator, renderFS, renderConsole, File, Folder, Clear} = require('..');
tape('lib test', async ({end}) => {end();});
//
const { execSync } = require('child_process');
const { existsSync } = require('fs');
const { join } = require('path');
const { promisify } = require('util');
const rimraf = require('rimraf');
const rmdir = promisify(rimraf);
const destination = './dist/temp';
tape('cli test: fileable build', async ({ ok, end }) => {
    // clear directory
    await rmdir(destination);
    // run program
    // execSync(`${fileable} build ./test/example/template.jsx ${destination} --no-test`);
    execSync(`npm run fileable -- build ./test/example/template.jsx ${destination} --no-test --input ./test/example/input.js `);
    // begin tests
    ok(existsSync(destination), 'destination should be created') ;
    ok(existsSync(join(destination, 'docs')), 'folder should be created');
    ok(existsSync(join(destination, 'google.html')), 'file should be created within folder');
    ok(existsSync(join(destination, 'docs/readme.md')), 'file should be created within folder');
    ok(existsSync(join(destination, 'created')), 'file should be created within folder');
    ok(existsSync(join(destination, 'index.html')), 'generic file shoud be created');
    ok(existsSync(join(destination, 'index.js')), 'generic file shoud be created');
    ok(existsSync(join(destination, 'index.css')), 'generic file shoud be created');
    end();
    rmdir(destination);
    // finish tests
});
