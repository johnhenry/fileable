import iterator from 'fileable-iterator';
import { existsSync, lstatSync, unlinkSync } from 'fs';
import chalk from 'chalk';
/**
* Render file tree to console
* @kind function
* @name renderConsole
* @param {function} input
* @param {object} options
* @param {string} options.folder_context - Folder into which files should be renddered
* @param {string} options.template_context - Location of template. Used to determine relateive 'src' attributes
* @example
* ```javascript
* import { renderConsole, iterator } from 'fileable';
* const main = async () =>
* renderConsole(template, { folder_context: '.' });
* main();
* ```
*/
import { join } from 'path';
import { glob } from 'glob';
import { promisify } from 'util';
const findFiles = promisify(glob);

export default async (template, {
    folder_context = '',
    template_context = ''
}) => {
    console.log(folder_context);
    let previousContext = folder_context;
    let currentContext = '';
    let depth = 0;
    let previous = null;
    for await (const {directive, folder_context:context, name, content, target} of iterator(template, {
        folder_context,
        template_context
    })) {
        currentContext = context;
        if (currentContext === previousContext) {

        } else if (currentContext
            .indexOf(previousContext) === 0) {//Push
            depth++;

        } else if (previousContext
            .indexOf(currentContext) === 0) {//Pop
            depth--;
        }
        const pre = [];
        switch (depth) {
            case 0:
                pre.push('');
                break;
            default:
                pre.push('|');
                for (let i = 0; i < 2 * depth - 1; i++) {
                    pre.push(' ');
                }
                break;
        }
        if (directive === 'FILE' || directive === 'FOLDER') {
            console.log(`+${pre.join('')}├ ${name}${content ? ` (${content.length} bytes)` :''  }`);
        } else if (directive === 'CLEAR') {
            if (target) {
                let files;
                if (target[0] !== '!') {
                    files = await findFiles(join(context, target));
                } else {
                    files = await findFiles(join(context, '**'), { ignore: target.substring(1) });
                }
                if (files && files.length) {
                    for (const file of files) {
                        if (lstatSync(file).isDirectory()) {
                            continue;
                        }
                        console.log(`-${pre.join('')}├ ${file}`);
                    }
                } else {
                    console.log(`-${pre.join('')}├ ${join(context, target)}`);
                }
            } else {
                console.log(`-${pre.join('')}├ ${context}`);
            }
        }
        previousContext = currentContext;
    }
};
