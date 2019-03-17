const tape = require('tape');
const {
    main,
    bin: {
        fileable
    }
} = require('../package.json');
//
const pkgDir = require('pkg-dir');
const {
    iterator,
    renderFS,
    renderConsole,
    File,
    Folder,
    Clear
} = require(pkgDir.sync());
tape('lib test', async ({
    end
}) => {
    end();
});
//
const {
    execSync
} = require('child_process');
const {
    existsSync
} = require('fs');
const {
    join
} = require('path');
const {
    promisify
} = require('util');
const rimraf = require('rimraf');
const rmdir = promisify(rimraf);
const destination = './dist/temp/demo-human-input';
tape('cli test: fileable build', async ({
    ok,
    end
}) => {
    // clear directory
    await rmdir(destination);
    // execSync(`${fileable} build ./test/example/template.jsx ${destination} --no-test`);
    execSync(`${fileable} build ./test/example/template.human.jsx ${destination} --no-test --input ./test/example/input.human.js `);
    // clear directory
});
