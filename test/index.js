const tape = require('tape');
//
const { execSync } = require('child_process');
const { existsSync, readFileSync, statSync} = require('fs');
const { join } = require('path');
const { promisify } = require('util');
const rimraf = require('rimraf');
const rmdir = promisify(rimraf);
const destination = './dist/temp';

const parseMode = (mode) => mode & parseInt('777', 8);
const EMPTY_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

tape('cli test: build file 00', async ({ ok, end, equal }) => {

    // clear directory
    await rmdir(destination);
    // run program
    execSync(`npm run fileable -- build ./test/template/file.00.jsx ${destination} --no-test`);
    // begin tests
    ok(existsSync(join(destination, EMPTY_HASH)), 'empty file should be created with computed hash');
    ok(existsSync(join(destination, 'empty')), 'empty file should be created with given name');
    ok(existsSync(join(destination, `${EMPTY_HASH}.md`)), 'empty file should be created with computed hash and given extension');
    ok(existsSync(join(destination, 'empty.md')), 'empty file should be created given name and given extension');
    equal('Hello', readFileSync(join(destination, 'hello')).toString(), 'file should be created with children as content');
    equal('World', readFileSync(join(destination, 'world')).toString(), 'file should be created with attrubute "content" as content');
    ok(readFileSync(join(destination, 'google.html')).toString().indexOf('<!doctype html>') === 0, 'file should be downloaded');
    ok(readFileSync(join(destination, 'package.json')).toString().indexOf('{') === 0, 'local file should be downloaded relative to template');
    ok(Math.abs(new Date(readFileSync(join(destination, 'datefile')).toString()) - Date.now()) < 10000, 'file should be generated dynamically from command');
    ok(readFileSync(join(destination, 'foodfile')).toString().indexOf('Broccoli') === -1, 'file should be content should be piped through command');
    equal(0o655, statSync(join(destination, 'permission')).mode & (8 ** 3 - 1), 'file should be created with mode 655');
    ok(readFileSync(join(destination, 'index.html')).toString().indexOf('<html>') === 0, '');
    ok(readFileSync(join(destination, 'index-doctype.html')).toString().indexOf('<!doctype html>') === 0, 'local file should be downloaded relative to template');
    equal('HelloHello', readFileSync(join(destination, 'double')).toString(), '');
    equal('HelloHelloGoodbye', readFileSync(join(destination, 'doubleps')).toString(), '');
    equal('WorldWorld', readFileSync(join(destination, 'doubleclone')).toString(), '');

    end();
    // finish tests
    await rmdir(destination);
});

tape('cli test: build folder 00', async ({ ok, end, equal }) => {

    // clear directory
    await rmdir(destination);

    // run program
    execSync(`npm run fileable -- build ./test/template/folder.00.jsx ${destination} --no-test`);
    // begin tests
    ok(existsSync(join(destination, 'top')), 'folder should be created');
    ok(existsSync(join(destination, 'top', 'next')), 'sub-folder should be created within folder');
    ok(existsSync(join(destination, 'top', EMPTY_HASH)), 'file should be created within folder');
    ok(existsSync(join(destination, 'zipped.zip')), 'zipped folder should be created');
    // TODO .zip doesn't seem to work?
    end();
    // finish tests
    await rmdir(destination);
});

tape('cli test: build clear 00', async ({ ok, end, equal, notOk }) => {

    // clear directory
    await rmdir(destination);
    // run program
    execSync(`npm run fileable -- build ./test/template/clear.00.jsx ${destination} --no-test`);
    // begin tests
    notOk(existsSync(join(destination, 'i_should_not_be')), 'previous file shuould be deleted');
    ok(existsSync(join(destination, 'i_should_be')), 'new file shoud be created');
    end();
    // finish tests
    await rmdir(destination);
});

tape('cli test: build clear 01', async ({ ok, end, notOk }) => {

    // clear directory
    await rmdir(destination);
    // run program
    execSync(`npm run fileable -- build ./test/template/clear.01.jsx ${destination} --no-test`);
    // begin tests
    notOk(existsSync(join(destination, 'a.html')), 'specified file shuould be deleted');
    ok(existsSync(join(destination, 'b.js')), 'unspecified file shuould remain');
    notOk(existsSync(join(destination, '0', 'c.html')), 'specified file should be deleted');
    ok(existsSync(join(destination, '0', 'd.js')), 'unspecified files should remain');
    end();
    // finish tests
    await rmdir(destination);
});

tape('cli test: build clear 02', async ({ ok, end, notOk }) => {
    // clear directory
    await rmdir(destination);
    // run program
    execSync(`npm run fileable -- build ./test/template/clear.02.jsx ${destination} --no-test`);
    // begin tests

    ok(existsSync(join(destination, 'a.html')), 'unspecified file shuould remain');
    notOk(existsSync(join(destination, 'b.js')), 'specified file shuould be deleted');
    ok(existsSync(join(destination, '0', 'c.html')), 'unspecified files should remain');
    notOk(existsSync(join(destination, '0', 'd.js')), 'specified file should be deleted');

    end();
    // finish tests
    await rmdir(destination);
});
