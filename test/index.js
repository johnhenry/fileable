const tape = require('tape');
//
const { execSync } = require('child_process');
const { existsSync, readFileSync, statSync } = require('fs');
const { join } = require('path');
const { promisify } = require('util');
const rimraf = require('rimraf');
const rmdir = promisify(rimraf);
const folder_context = './dist/temp';
const template_context = './test/template';
const parseMode = (mode) => mode & 0o777;
const EMPTY_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

import { renderFS } from '../';

import templateFile00 from './template/file.00.jsx';
import templateFolder00 from './template/folder.00.jsx';
import templateClear00 from './template/clear.00.jsx';
import templateClear01 from './template/clear.01.jsx';
import templateClear02 from './template/clear.02.jsx';

tape('cli test: build file 00', async ({ ok, end, equal }) => {

    // clear directory
    await rmdir(folder_context);
    // run program
    await renderFS(templateFile00, { folder_context, template_context});
    // begin tests
    ok(existsSync(join(folder_context, EMPTY_HASH)), 'empty file should be created with computed hash');
    ok(existsSync(join(folder_context, 'empty')), 'empty file should be created with given name');
    ok(existsSync(join(folder_context, `${EMPTY_HASH}.md`)), 'empty file should be created with computed hash and given extension');
    ok(existsSync(join(folder_context, 'empty.md')), 'empty file should be created given name and given extension');
    equal('Hello', readFileSync(join(folder_context, 'hello')).toString(), 'file should be created with children as content');
    equal('World', readFileSync(join(folder_context, 'world')).toString(), 'file should be created with attrubute "content" as content');
    ok(readFileSync(join(folder_context, 'google.html')).toString().indexOf('<!doctype html>') === 0, 'file should be downloaded');
    ok(readFileSync(join(folder_context, 'package.json')).toString().indexOf('{') === 0, 'local file should be downloaded relative to template');
    ok(Math.abs(new Date(readFileSync(join(folder_context, 'datefile')).toString()) - Date.now()) < 10000, 'file should be generated dynamically from command');
    ok(readFileSync(join(folder_context, 'foodfile')).toString().indexOf('Broccoli') === -1, 'file should be content should be piped through command');
    equal(0o655, statSync(join(folder_context, 'permission')).mode & (8 ** 3 - 1), 'file should be created with mode 655');
    ok(readFileSync(join(folder_context, 'index.html')).toString().indexOf('<html>') === 0, 'html should be rendered');
    ok(readFileSync(join(folder_context, 'index-doctype.html')).toString().indexOf('<!doctype html>') === 0, 'doctype preamble should be rendered');
    equal('HelloHello', readFileSync(join(folder_context, 'double')).toString(), '');
    equal('HelloHelloGoodbye', readFileSync(join(folder_context, 'doubleps')).toString(), '');
    equal('WorldWorld', readFileSync(join(folder_context, 'doubleclone')).toString(), '');
    ok(existsSync(join(folder_context, 'composed')), 'components should be composable');
    equal('01', readFileSync(join(folder_context, 'append')).toString(), 'content should be appended');
    equal('1\n', readFileSync(join(folder_context, 'end')).toString(), 'new line should be appended to end of file');

    end();
    // finish tests
    await rmdir(folder_context);
});


tape('cli test: build folder 00', async ({ ok, end, equal }) => {

    // clear directory
    await rmdir(folder_context);

    // run program
    await renderFS(templateFolder00, { folder_context, template_context });    // begin tests
    ok(existsSync(join(folder_context, 'top')), 'folder should be created');
    ok(existsSync(join(folder_context, 'top', 'next')), 'sub-folder should be created within folder');
    ok(existsSync(join(folder_context, 'top', EMPTY_HASH)), 'file should be created within folder');
    ok(existsSync(join(folder_context, 'zipped.zip')), 'zipped folder should be created');
    // TODO .zip doesn't seem to work?
    end();
    // finish tests
    await rmdir(folder_context);
});

tape('cli test: build clear 00', async ({ ok, end, equal, notOk }) => {

    // clear directory
    await rmdir(folder_context);
    // run program
    await renderFS(templateClear00, { folder_context, template_context });
    // begin tests
    notOk(existsSync(join(folder_context, 'i_should_not_be')), 'previous file shuould be deleted');
    ok(existsSync(join(folder_context, 'i_should_be')), 'new file shoud be created');
    end();
    // finish tests
    await rmdir(folder_context);
});

tape('cli test: build clear 01', async ({ ok, end, notOk }) => {

    // clear directory
    await rmdir(folder_context);
    // run program
    await renderFS(templateClear01, { folder_context, template_context });
    // begin tests
    notOk(existsSync(join(folder_context, 'a.html')), 'specified file shuould be deleted');
    ok(existsSync(join(folder_context, 'b.js')), 'unspecified file shuould remain');
    notOk(existsSync(join(folder_context, '0', 'c.html')), 'specified file should be deleted');
    ok(existsSync(join(folder_context, '0', 'd.js')), 'unspecified files should remain');
    end();
    // finish tests
    await rmdir(folder_context);
});

tape('cli test: build clear 02', async ({ ok, end, notOk }) => {
    // clear directory
    await rmdir(folder_context);
    // run program
    await renderFS(templateClear02, { folder_context, template_context });
    // begin tests

    ok(existsSync(join(folder_context, 'a.html')), 'unspecified file shuould remain');
    notOk(existsSync(join(folder_context, 'b.js')), 'specified file shuould be deleted');
    ok(existsSync(join(folder_context, '0', 'c.html')), 'unspecified files should remain');
    notOk(existsSync(join(folder_context, '0', 'd.js')), 'specified file should be deleted');

    end();
    // finish tests
    await rmdir(folder_context);
});
