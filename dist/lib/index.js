'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var fs = _interopDefault(require('fs'));
var path = _interopDefault(require('path'));
var rimraf = _interopDefault(require('rimraf'));
var util = require('util');
var glob = require('glob');

/**
 * Iterator
 * @kind function
 * @description
 * @name iterator
 * @param {object} options
 * @param {string} options.folder_context - Folder into which files should be rendered.
 * @param {string} options.template_context - Location of template. Used to determine relative relative paths of certain attributes.
 * @example
 * ```javascript
 * import {iterator} from 'fileable';
 * const main = async ()=>{
 *  for await(const output of iterator(template, {})){
 *    console.log(output);
 *  }
 * }
 * ```
 */
const iterator = async function* (element, {
        folder_context = '',
        template_context =''
        } = {
            folder_context: '',
            template_context:''
    }) {
    element = await element;
    if (element.type && element.type['FILEABLE COMPONENT']) {
        yield* element.type({
            folder_context,
            template_context,
            ...element.props
        });
    } else if (element.type === Symbol.for('react.fragment')) {
        const children = Array.isArray(element.props.children)
            ? element.props.children
            : element.props.children
            ? [element.props.children]
            : [];
        for (const child of children) {
            yield* iterator(child, {
                folder_context,
                template_context
            });
        }
    } else {
        if (typeof element.type === 'function') {
            yield* iterator(element.type({
                ...element.props
            }), {folder_context, template_context});
        }else if (typeof element === 'function') {
            yield* iterator(element({
                ...element.props
            }), { folder_context, template_context });
        }
    }
};

// import CacheMap from './cache-map.ts';
const rmdir = util.promisify(rimraf);
const findFiles = util.promisify(glob.glob);

/**
* Render file tree to file system
* @kind function
* @name renderFS
* @param {function} input
* @param {object} options
* @param {string} options.folder_context - Folder into which files should be renddered
* @param {string} options.template_context - Location of template. Used to determine relateive
* @example
* ```javascript
* import {renderFS} from 'fileable';
* const main = async () =>
* renderFS(template, { folder_context: '.' });
* main();
* ```
*/

var renderFs = async (template,
    {
        folder_context = '',
        template_context = ''
    } ) => {

    try {
        const context = folder_context;
        for await (const {
            directive,
            target,
            name,
            append,
            content,
            folder_context,
            mode
        } of
            iterator(template, { folder_context: context, template_context })
        ) {
            switch (directive) {
                case 'FILE': {
                    const folderPath = path.join(folder_context);
                    if (!fs.existsSync(folderPath)) {
                        fs.mkdirSync(folderPath, { recursive: true });
                    }
                    const fileName = path.join(folderPath, name);
                    if (append) {
                        fs.appendFileSync(fileName, content, { mode });
                    } else {
                        fs.writeFileSync(fileName, content, { mode });
                    }
                } break;
                case 'FOLDER': {
                    const folderPath = path.join(folder_context, name);
                    if (!fs.existsSync(folderPath)) {
                        fs.mkdirSync(folderPath, { recursive: true });
                    }
                } break;
                case 'CLEAR': {
                    if (target) {
                        let files;
                        if (target[0] !== '!' ) {
                            files = await findFiles(path.join(folder_context, target));
                        } else {
                            files = await findFiles(path.join(folder_context, '**'), { ignore: target.substring(1) });
                        }
                        for (const file of files) {
                            if (fs.lstatSync(file).isDirectory()) {
                                continue;
                            }
                            fs.unlinkSync(file);
                        }
                    } else {
                        const folderPath = path.join(folder_context, target);
                        fs.existsSync(folderPath);
                        if (fs.existsSync(folderPath)) {
                            await rmdir(folderPath);
                        }
                    }
                } break;
                default: {
                    console.log({
                        directive,
                        target,
                        name,
                        append,
                        content,
                        folder_context,
                        mode
                    });
                }
            }
        }
    } catch (e) {
        console.log(e);
    } finally {

    }
};

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
var renderConsole = async (template, {
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

exports.iterator = iterator;
exports.renderConsole = renderConsole;
exports.renderFS = renderFs;
