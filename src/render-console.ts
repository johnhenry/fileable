import iterator from './iterator.ts';

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
    for await (const output of iterator(template, {
        folder_context,
        template_context
    })) {
        console.log(output);
    }
};
