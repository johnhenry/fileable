#!/usr/bin/env node
'use strict';

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var yargs = _interopDefault(require('yargs'));
var fs = _interopDefault(require('fs'));
var path = require('path');
var child_process = require('child_process');

const node = path.join(__dirname, '../../node_modules/@babel/node/bin/babel-node.js --presets @babel/preset-react,@babel/preset-env');
const tempFileName = (parentDirectory, suffix = '') => path.join(parentDirectory, `${Math.random()}.temp${suffix}`);
const regexp = /[^\s"]+|"([^"]*)"/gi;

const command = 'build <template> <destination>';
const describe = 'Build a file tree from template into destination directory';
const builder = {
    test: {
        type: 'boolean',
        default: true,
        desc: 'write to console instead of fs'
    }
};
const handler = ({
    template: t,
    destination: d,
    test
}) => {
    const tempname = tempFileName(__dirname, ".js");
    try {
        const template = path.join(process.cwd(), t);
        const destination = path.join(process.cwd(), d || tempFileName('', ''));
        const template_context = path.dirname(template);
        const file = `import template from '${template}';
    import {render${test ? 'Console' : 'FS'} as render} from "${path.join(__dirname, `../../src/index.js`)}";
    render(template, {folder_context:['${destination}'], template_context:'${template_context}'});
    `;

        fs.writeFileSync(tempname, file);
        const array = [];
        let match;
        do {
            match = regexp.exec(`${node} ${tempname}`);
            if (match !== null) {
                array.push(match[1] ? match[1] : match[0]);
            }
        } while (match !== null);
        const ps = child_process.spawn(array.shift(), array, {
            stdio: 'inherit'
        });
        ps.on('close', function () {
            fs.unlinkSync(tempname);
        });
    } catch (error) {
        if (fs.existsSync(tempname)) {
            fs.unlinkSync(tempname);
        }
        throw error;
    } finally {}
};

var build = /*#__PURE__*/Object.freeze({
    command: command,
    describe: describe,
    builder: builder,
    handler: handler
});

//https://stackoverflow.com/questions/2817646/javascript-split-string-on-space-or-on-quotes-to-array
yargs
    .command(build)
    .demandCommand()
    .help()
    .argv;
