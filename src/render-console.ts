import iterator from 'fileable-iterator';
import { stringify } from 'querystring';

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

export default async (template, {
    folder_context = '',
    template_context = ''
}) => {
    console.log(folder_context);
    let previousContext = folder_context;
    let currentContext = '';
    let depth = 0;
    let previous = null;
    for await (const {directive, folder_context:context, name, content} of iterator(template, {
        folder_context,
        template_context
    })) {

        if (directive === 'FILE' || directive === 'FOLDER') {
            currentContext = context;
            if (currentContext === previousContext) {

            } else if (currentContext
                .indexOf(previousContext) === 0) {//Push
                depth ++;

            } else if (previousContext
                .indexOf(currentContext) === 0) {//Pop
                depth --;
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
            console.log(`${pre.join('')}├ ${name}${content ? ` (${content.length} bytes)` :''  }`);
        }
        previousContext = currentContext;
    }
};
