const tape = require('tape');
const { bin: { fileable } } = require('../package.json');
//
const pkgDir = require('pkg-dir');
const {iterator, renderFS, renderConsole, File, Folder, Clear} = require(pkgDir.sync());
tape('lib test', async ({
    end
}) => {
    end();
});
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
    execSync(`${fileable} build ./test/example/template.jsx ${destination} --no-test --input ./test/example/input.js `);
    // begin tests
    ok(existsSync(destination), 'destination should be created') ;
    ok(existsSync(join(destination, 'fldr')), 'folder should be created');
    ok(existsSync(join(destination, 'fldr/readme.md')), 'file should be created within folder');
    ok(existsSync(join(destination, 'index.js')), 'generic file shoud be created');
    ok(existsSync(join(destination, 'index.map.js')), 'sidecar file shoud be created');
    ok(existsSync(join(destination, 'index.html')), 'generic file shoud be created');
    ok(existsSync(join(destination, 'index.css')), 'generic file shoud be created');
    end();
    // finish tests
    // clear directory
    await rmdir(destination);
});
