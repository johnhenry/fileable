import iterator from './iterator.ts';
const defaultOptions = {
    folder_context: [],
    template_context:''
};

/**
* Render to Console
* @kind function
* @name renderConsole
* @param {object} input
* @example
* ```javascript
* import {renderConsole} from 'fileable';
* const main = async () =>
* renderConsole(template(), { folder_context: [directory] });
* main();
* ```
*/
export default async (template, {
    folder_context = defaultOptions.folder_context,
    template_context = defaultOptions.template_context
    } = defaultOptions) => {
    for await (const output of iterator(template(), {
        folder_context,
        template_context
    })) {
        console.log(output);
    }
};
