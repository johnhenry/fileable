#!/usr/bin/env node
//https://stackoverflow.com/questions/2817646/javascript-split-string-on-space-or-on-quotes-to-array
const { join, dirname } = require('path');
const { spawn } = require('child_process');
const yargs = require('yargs')
    .boolean('commit');
const node = join(__dirname, '../node_modules/@babel/node/bin/babel-node.js --presets @babel/preset-react,@babel/preset-env');
const tempFileName = (parentDirectory, suffix = '') => join(parentDirectory, `${Math.random()}.temp${suffix}`)
const fs = require('fs');
const regexp = /[^\s"]+|"([^"]*)"/gi;
const main = async ({ commit, _ }) => {
    const template = join(process.cwd(), _[0]);
    const template_context = dirname(template);
    const destination = join(process.cwd(), _[1] || tempFileName('',''));
//     const file = `import template from '${template}';
// import render from "${join(__dirname, `../lib/render-${commit ? 'fs' : 'console'}.js`)}";
// render(template, {folder_context:['${destination}'], template_context:'${template_context}'});
// `;
    const file = `import template from '${template}';
import {render${commit ? 'FS' : 'Console'} as render} from "${join(__dirname, `../lib/index.js`)}";
render(template, {folder_context:['${destination}'], template_context:'${template_context}'});
`;

    const tempname = tempFileName(__dirname, ".js");
    fs.writeFileSync(tempname, file);

    const array = [];
    let match;
    do {
        match = regexp.exec(`${node} ${tempname}`);
        if (match !== null) {
            array.push(match[1] ? match[1] : match[0]);
        }
    } while (match !== null);
    const ps = spawn(array.shift(), array, { stdio: 'inherit' });
    ps.on('close', function () {
        fs.unlinkSync(tempname);
    });
}
main(yargs.argv);

// ``
// `bash
// re-file
//     make
//         --no-async\
//         --partial\
//         --cache=./cache\
// [seedfile=index.jsx] ./output
// [location=.]
//     unmake
//         --inline\
//         --no-inline\
// `
// ``
