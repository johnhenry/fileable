#!/usr/bin/env node
'use strict';

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var fs = require('fs');
var fs__default = _interopDefault(fs);
var yargs = _interopDefault(require('yargs'));
var findUp = _interopDefault(require('find-up'));
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
    },
    input: {
        type: 'string',
        default: '',
        desc: 'imported input file (must export iterator)'
    }
};
const handler = ({
    template: t,
    destination: d,
    test,
    input
}) => {
    const tempname = tempFileName(__dirname, ".js");
    try {
        const template = path.join(process.cwd(), t);
        const destination = path.join(process.cwd(), d || tempFileName('', ''));
        const template_context = path.dirname(template);
        const file = `import template from '${template}';
import {render${test ? 'Console' : 'FS'} as render} from "${path.join(__dirname, `../../src/index.js`)}";
${input ? `import input from "${path.join(process.cwd(), input)}";\n` : ''}
render(template(${input ? `...input` : ''}), {folder_context:['${destination}'], template_context:'${template_context}'});
`;
        fs__default.writeFileSync(tempname, file);
        const array = [];
        let match;
        //https://stackoverflow.com/questions/2817646/javascript-split-string-on-space-or-on-quotes-to-array
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
            fs__default.unlinkSync(tempname);
        });
    } catch (error) {
        if (fs__default.existsSync(tempname)) {
            fs__default.unlinkSync(tempname);
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

const configPath = findUp.sync(['.myapprc', '.myapprc.json']);
const config = configPath ? JSON.parse(fs.readFileSync(configPath)) : {};
yargs
    .config(config)
    .command(build)
    .demandCommand()
    .help()
    .argv;
