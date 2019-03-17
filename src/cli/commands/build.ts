import fs from 'fs';
import { join, dirname } from 'path';
import { spawn } from 'child_process';
const node = join(__dirname, '../../node_modules/@babel/node/bin/babel-node.js --presets @babel/preset-react,@babel/preset-env');
const tempFileName = (parentDirectory, suffix = '') => join(parentDirectory, `${Math.random()}.temp${suffix}`);
const regexp = /[^\s"]+|"([^"]*)"/gi;

export const command = 'build <template> <destination>';
export const describe = 'Build a file tree from template into destination directory';
export const builder = {
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
export const handler = ({
    template: t,
    destination: d,
    test,
    input
}) => {
    const tempname = tempFileName(__dirname, '.js');
    try {
        const template = join(process.cwd(), t);
        const destination = join(process.cwd(), d || tempFileName('', ''));
        const template_context = dirname(template);
        const file = `import template from '${template}';
import {render${test ? 'Console' : 'FS'} as render} from "../../dist/lib/index.js";
${input ? `import input from "${join(process.cwd(), input)}";\n` : ''}
render(template(${input ? '...input' : ''}), {folder_context:['${destination}'], template_context:'${template_context}'});
`;
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
    }
};
