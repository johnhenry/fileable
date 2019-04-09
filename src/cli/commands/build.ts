import * as fs from 'fs';
import { join, dirname } from 'path';
import { spawn } from 'child_process';
import fetch from 'node-fetch';
const node = join(__dirname, '../../node_modules/@babel/node/bin/babel-node.js --presets @babel/preset-react,@babel/preset-env ');
const CURRENT_RAND = Math.random();
let RAND_INDEX = 0;

const tempFileName = (parentDirectory, suffix = '') => join(parentDirectory, `${CURRENT_RAND}_${RAND_INDEX++}.temp${suffix}`);

const regexp = /[^\s"]+|"([^"]*)"/gi;
const remoteFileMatch = /^(?:(?:https?)|(?:ftp)):\/\//;

const importPreamble = '';

const localizer = (path, defaultPath = undefined) =>
  path ? join(process.cwd(), path) : defaultPath;

export const command = 'build <template> <destination>';
export const describe = 'Build a file tree from template into destination directory.';
export const builder = {
    test: {
        type: 'boolean',
        default: true,
        desc: 'write to console instead of fs'
    },
    input: {
        type: 'string',
        default: '',
        desc: 'imported input file (must export [asynchronous] iterator)'
    }
};

export const handler = async ({
    template: t = '',
    destination: d,
    input: i = '',
    test
}) => {
    const tempname = tempFileName(__dirname, '.js');
    let remoteTemplate;
    let remoteInput;
    try {
        const template = (t||'').match(remoteFileMatch) ? t : localizer(t);
        const destination = localizer(d || tempFileName('', ''));
        const input = (i && i.match(remoteFileMatch)) ? i : localizer(i||'');
        const template_context = dirname(template);

        remoteTemplate = template.match(remoteFileMatch) && tempFileName(__dirname, '.jsx');
        remoteInput = input && input.match(remoteFileMatch) && tempFileName(__dirname, '.js');

        if (remoteTemplate) {
            const response = await fetch(template);
            const text = await response.text();
            fs.writeFileSync(remoteTemplate, `${importPreamble}${text}`);
        } else if (template) {
            remoteTemplate = tempFileName(__dirname, '.jsx');
            fs.writeFileSync(remoteTemplate, importPreamble);
            fs.appendFileSync(remoteTemplate, fs.readFileSync(template), );
        }

        if (remoteInput) {
            const response = await fetch(input);
            const text = await response.text();
            fs.writeFileSync(remoteInput, text);
        } else if (input) {
            remoteInput = tempFileName(__dirname, '.js');
            fs.copyFileSync(input, remoteInput);
        }

        const file = `import template from '${remoteTemplate}';
import {render${test ? 'Console' : 'FS'} as render} from "../../dist/lib/index.js";
${remoteInput ? `import args from "${remoteInput}";` : ''}
const main = async()=>{
${remoteInput ? `const input = [];
for await(const arg of args){
    input.push(arg);
}
`: ''}
render(await template(${remoteInput ? '... input' : ''}), {folder_context:'${destination}', template_context:'${template_context}'});
}
main();
// `;
        fs.writeFileSync(tempname, file);
        const array = [];
        let match;
        //https://stackoverflow.com/questions/2817646/javascript-split-string-on-space-or-on-quotes-to-array
        do {
            match = regexp.exec(`${node} ${tempname}`);
            if (match !== null) {
                array.push(match[1] ? match[1] : match[0]);
            }
        } while (match !== null);
        const ps = spawn(array.shift(), array, {
            stdio: 'inherit',
            cwd: join(__dirname,'../../')
        });
        ps.on('close', function () {
            fs.unlinkSync(tempname);
            if (remoteTemplate) {
                fs.unlinkSync(remoteTemplate);
            }
            if (remoteInput) {
                fs.unlinkSync(remoteInput);
            }
        });
    } catch (error) {
        if (fs.existsSync(tempname)) {
            fs.unlinkSync(tempname);
        }
        if (remoteTemplate && fs.existsSync(remoteTemplate)) {
            fs.unlinkSync(remoteTemplate);
        }
        if (remoteInput && fs.existsSync(remoteInput)) {
            fs.unlinkSync(remoteInput);
        }
        throw error;
    }
};
